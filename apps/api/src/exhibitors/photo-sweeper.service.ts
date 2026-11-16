import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { DatabaseService } from '../db/database.service.js';
import { exhibitorPhotos, tenants } from '../db/schema.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../storage/object-storage.js';
import { AuditService } from '../tenancy/audit.service.js';

const INTERVAL_MS = 10 * 60_000;
const BATCH = 100;

export interface PhotoSweepSummary {
  readonly deleted: number;
  /** Tenants whose sweep failed; their rows stay for the next run. */
  readonly failedTenants: number;
}

/**
 * Housekeeping for stand photos: `requestUpload` registers a PENDING row and the browser PUTs
 * straight to storage; if `complete` never comes the row and the object would live forever.
 * Mirrors ExhibitorDocumentsSweeper: FOR UPDATE SKIP LOCKED makes several replicas safe, the
 * object is removed inside the transaction (idempotent), each tenant is swept under its own RLS
 * context. Logs and audit entries carry counts and ids, never storage keys or URLs.
 */
@Injectable()
export class ExhibitorPhotosSweeper
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ExhibitorPhotosSweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(configuration.KEY) private readonly env: AppConfiguration,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.nodeEnv === 'test') return; // tests call run() directly
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async run(now: Date = new Date()): Promise<PhotoSweepSummary> {
    const all = await this.database.db.select({ id: tenants.id }).from(tenants);
    let deleted = 0;
    let failedTenants = 0;
    for (const { id } of all) {
      try {
        deleted += await this.sweepTenant(id, now);
      } catch (error) {
        failedTenants += 1;
        this.logger.error(
          `Sweeping unconfirmed photos failed for tenant ${id} (${error instanceof Error ? error.name : 'unknown error'})`,
        );
      }
    }
    return { deleted, failedTenants };
  }

  async sweepTenant(tenantId: string, now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - this.env.documentUploadTtlMinutes * 60_000,
    );
    let total = 0;
    for (;;) {
      const removed = await this.sweepBatch(tenantId, cutoff);
      total += removed;
      if (removed < BATCH) return total;
    }
  }

  private sweepBatch(tenantId: string, cutoff: Date): Promise<number> {
    return this.database.withTenant(tenantId, async (tx) => {
      const expired = await tx
        .select({
          id: exhibitorPhotos.id,
          createdAt: exhibitorPhotos.createdAt,
          storageKey: exhibitorPhotos.storageKey,
        })
        .from(exhibitorPhotos)
        .where(
          and(
            eq(exhibitorPhotos.status, 'PENDING'),
            lt(exhibitorPhotos.createdAt, cutoff),
          ),
        )
        .limit(BATCH)
        .for('update', { skipLocked: true });
      for (const photo of expired) {
        await this.storage.remove(photo.storageKey);
        await tx
          .delete(exhibitorPhotos)
          .where(eq(exhibitorPhotos.id, photo.id));
        await this.audit.record(tx, {
          actorId: null,
          action: 'exhibitor_photo.upload_expired',
          entityType: 'exhibitor_photo',
          entityId: photo.id,
          before: { status: 'PENDING', createdAt: photo.createdAt },
        });
      }
      return expired.length;
    });
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const summary = await this.run();
      if (summary.deleted > 0 || summary.failedTenants > 0)
        this.logger.log(`Unconfirmed photos swept: ${JSON.stringify(summary)}`);
    } catch (error) {
      this.logger.error(
        'Sweeping unconfirmed photos failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}

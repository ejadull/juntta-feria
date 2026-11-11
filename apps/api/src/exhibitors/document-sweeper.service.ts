import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, isNull, lt } from 'drizzle-orm';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { DatabaseService } from '../db/database.service.js';
import { exhibitorDocuments, tenants } from '../db/schema.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../storage/object-storage.js';
import { AuditService } from '../tenancy/audit.service.js';

const INTERVAL_MS = 10 * 60_000;
const BATCH = 100;

export interface DocumentSweepSummary {
  readonly deleted: number;
  /** Tenants whose sweep failed (storage or database); their rows stay for the next run. */
  readonly failedTenants: number;
}

/**
 * EXH-03 housekeeping: `requestUpload` registers a row and the browser PUTs straight to storage;
 * if `complete` never comes (closed tab, failed upload) the row and the object would live forever.
 * This job deletes the rows still unconfirmed after DOCUMENT_UPLOAD_TTL_MINUTES and their objects.
 *
 * Several instances may run it at once: rows are taken with FOR UPDATE SKIP LOCKED, so each row
 * is handled by one of them, and a row a `complete` is confirming right now (it holds the lock)
 * is skipped. The object is deleted inside the transaction: if the storage fails the row stays
 * and the next run retries; if only the commit fails, the row stays pointing at a missing object
 * and the next run deletes it again (the delete is idempotent). Tenants are listed like the
 * reconciliation job does (`tenants` has no RLS) and each one is swept under its own RLS context.
 *
 * Logs and audit entries carry counts and document ids, never storage keys or URLs.
 */
@Injectable()
export class ExhibitorDocumentsSweeper
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ExhibitorDocumentsSweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(configuration.KEY) private readonly env: AppConfiguration,
  ) {}

  /** ponytail: in-process interval, like the reconciliation job; SKIP LOCKED makes N replicas safe. */
  onApplicationBootstrap(): void {
    if (this.env.nodeEnv === 'test') return; // tests call run() directly
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async run(now: Date = new Date()): Promise<DocumentSweepSummary> {
    const all = await this.database.db.select({ id: tenants.id }).from(tenants);
    let deleted = 0;
    let failedTenants = 0;
    for (const { id } of all) {
      try {
        deleted += await this.sweepTenant(id, now);
      } catch (error) {
        failedTenants += 1;
        // Only the error type: a message could echo a storage key.
        this.logger.error(
          `Sweeping unconfirmed uploads failed for tenant ${id} (${error instanceof Error ? error.name : 'unknown error'})`,
        );
      }
    }
    return { deleted, failedTenants };
  }

  /** Removes the tenant's expired unconfirmed uploads; returns how many. */
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
          id: exhibitorDocuments.id,
          type: exhibitorDocuments.type,
          createdAt: exhibitorDocuments.createdAt,
          storageKey: exhibitorDocuments.storageKey,
        })
        .from(exhibitorDocuments)
        .where(
          and(
            isNull(exhibitorDocuments.uploadedAt),
            lt(exhibitorDocuments.createdAt, cutoff),
          ),
        )
        .limit(BATCH)
        .for('update', { skipLocked: true });
      for (const doc of expired) {
        await this.storage.remove(doc.storageKey); // idempotent: a missing object is fine
        await tx
          .delete(exhibitorDocuments)
          .where(eq(exhibitorDocuments.id, doc.id));
        await this.audit.record(tx, {
          actorId: null,
          action: 'exhibitor_document.upload_expired',
          entityType: 'exhibitor_document',
          entityId: doc.id,
          before: {
            type: doc.type,
            status: 'PENDING',
            createdAt: doc.createdAt,
          },
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
        this.logger.log(
          `Unconfirmed uploads swept: ${JSON.stringify(summary)}`,
        );
    } catch (error) {
      this.logger.error(
        'Sweeping unconfirmed uploads failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}

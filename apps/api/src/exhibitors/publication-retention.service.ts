import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { DatabaseService } from '../db/database.service.js';
import { events, exhibitorPhotos, tenants } from '../db/schema.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../storage/object-storage.js';
import { AuditService } from '../tenancy/audit.service.js';

const INTERVAL_MS = 10 * 60_000;
const BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionSummary {
  /** Publications deleted in this run (rows and files). */
  readonly deleted: number;
  /** Tenants whose run failed; their publications stay for the next run. */
  readonly failedTenants: number;
}

/**
 * Deletes the publications of events that ended (MED-12, change exh-media-share). `isRetentionDue`
 * states the rule in photo-policy: an event that ended `MEDIA_RETENTION_DAYS` ago. Profile photos
 * (no event) are never touched. Mirrors the pending-upload sweeper: each tenant under its own RLS
 * context, FOR UPDATE SKIP LOCKED so several replicas are safe, the file removed inside the
 * transaction (idempotent). Audit entries carry ids and dates, never storage keys or URLs.
 */
@Injectable()
export class PublicationRetentionSweeper
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PublicationRetentionSweeper.name);
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

  async run(now: Date = new Date()): Promise<RetentionSummary> {
    const all = await this.database.db.select({ id: tenants.id }).from(tenants);
    let deleted = 0;
    let failedTenants = 0;
    for (const { id } of all) {
      try {
        deleted += await this.sweepTenant(id, now);
      } catch (error) {
        failedTenants += 1;
        this.logger.error(
          `Deleting ended-event publications failed for tenant ${id} (${error instanceof Error ? error.name : 'unknown error'})`,
        );
      }
    }
    return { deleted, failedTenants };
  }

  async sweepTenant(tenantId: string, now: Date = new Date()): Promise<number> {
    // An event is due once it ended at least `retention` days before `now`: ends_at <= cutoff.
    const cutoff = new Date(now.getTime() - this.env.mediaRetentionDays * DAY_MS);
    let total = 0;
    for (;;) {
      const removed = await this.sweepBatch(tenantId, cutoff);
      total += removed;
      if (removed < BATCH) return total;
    }
  }

  private sweepBatch(tenantId: string, cutoff: Date): Promise<number> {
    return this.database.withTenant(tenantId, async (tx) => {
      const due = await tx
        .select({
          id: exhibitorPhotos.id,
          storageKey: exhibitorPhotos.storageKey,
          eventId: exhibitorPhotos.eventId,
          endsAt: events.endsAt,
        })
        .from(exhibitorPhotos)
        .innerJoin(
          events,
          and(
            eq(events.tenantId, exhibitorPhotos.tenantId),
            eq(events.id, exhibitorPhotos.eventId),
          ),
        )
        .where(and(isNotNull(exhibitorPhotos.eventId), lte(events.endsAt, cutoff)))
        .limit(BATCH)
        .for('update', { of: exhibitorPhotos, skipLocked: true });
      for (const publication of due) {
        await this.storage.remove(publication.storageKey);
        await tx.delete(exhibitorPhotos).where(eq(exhibitorPhotos.id, publication.id));
        await this.audit.record(tx, {
          actorId: null,
          action: 'exhibitor_publication.retention_deleted',
          entityType: 'exhibitor_photo',
          entityId: publication.id,
          before: { eventId: publication.eventId, endsAt: publication.endsAt },
        });
      }
      return due.length;
    });
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const summary = await this.run();
      if (summary.deleted > 0 || summary.failedTenants > 0)
        this.logger.log(`Ended-event publications deleted: ${JSON.stringify(summary)}`);
    } catch (error) {
      this.logger.error(
        'Deleting ended-event publications failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}

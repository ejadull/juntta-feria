import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DatabaseService, type Transaction } from '../db/database.service.js';
import { events, exhibitorPhotos, exhibitors } from '../db/schema.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../storage/object-storage.js';
import { AuditService } from '../tenancy/audit.service.js';
import {
  PHOTO_URL_TTL_SECONDS,
  visibilityAfter,
  type MediaKind,
} from './photo-policy.js';

/** A publication as the organizer of its event sees it; `url` is a short-lived signed link. */
export interface OrganizerPublication {
  readonly id: string;
  readonly status: 'READY' | 'HIDDEN';
  readonly kind: MediaKind;
  readonly caption: string | null;
  readonly durationS: number | null;
  readonly exhibitorName: string;
  readonly url: string;
}

const NOT_FOUND = 'Publication not found.';
const EVENT_NOT_FOUND = 'Event not found.';

const select = {
  id: exhibitorPhotos.id,
  status: exhibitorPhotos.status,
  kind: exhibitorPhotos.kind,
  contentType: exhibitorPhotos.contentType,
  caption: exhibitorPhotos.caption,
  durationS: exhibitorPhotos.durationS,
  storageKey: exhibitorPhotos.storageKey,
  exhibitorName: exhibitors.tradeName,
};

type Row = {
  id: string;
  status: string;
  kind: MediaKind;
  contentType: string;
  caption: string | null;
  durationS: number | null;
  storageKey: string;
  exhibitorName: string;
};

/**
 * Publications of one event, seen by its organizer (MED-11). Hiding keeps the file, so a shown
 * publication is the same one; the public surfaces filter on the status (map, share page).
 */
@Injectable()
export class PublicationModerationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  listForEvent(tenantId: string, eventId: string): Promise<OrganizerPublication[]> {
    return this.database.withTenant(tenantId, async (tx) => {
      await this.assertEvent(tx, eventId);
      const rows = await tx
        .select(select)
        .from(exhibitorPhotos)
        .innerJoin(
          exhibitors,
          and(
            eq(exhibitors.tenantId, exhibitorPhotos.tenantId),
            eq(exhibitors.id, exhibitorPhotos.exhibitorId),
          ),
        )
        .where(
          and(
            eq(exhibitorPhotos.eventId, eventId),
            inArray(exhibitorPhotos.status, ['READY', 'HIDDEN']),
          ),
        )
        .orderBy(asc(exhibitorPhotos.createdAt));
      return Promise.all(rows.map((row) => this.viewOf(row)));
    });
  }

  /** Hides (`hidden: true`) or shows (`false`) a publication of this event. */
  setHidden(
    tenantId: string,
    userId: string,
    eventId: string,
    photoId: string,
    hidden: boolean,
  ): Promise<OrganizerPublication> {
    return this.database.withTenant(tenantId, async (tx) => {
      await this.assertEvent(tx, eventId);
      const [row] = await tx
        .select(select)
        .from(exhibitorPhotos)
        .innerJoin(
          exhibitors,
          and(
            eq(exhibitors.tenantId, exhibitorPhotos.tenantId),
            eq(exhibitors.id, exhibitorPhotos.exhibitorId),
          ),
        )
        .where(
          and(eq(exhibitorPhotos.id, photoId), eq(exhibitorPhotos.eventId, eventId)),
        )
        .for('update', { of: exhibitorPhotos });
      if (!row) throw new NotFoundException(NOT_FOUND);
      const next = visibilityAfter(row.status, hidden);
      if (next === null)
        throw new ConflictException({
          message: 'Only published publications can be hidden or shown.',
          code: 'NOT_PUBLISHED',
        });
      if (next !== row.status) {
        await tx
          .update(exhibitorPhotos)
          .set({ status: next })
          .where(eq(exhibitorPhotos.id, photoId));
        await this.audit.record(tx, {
          actorId: userId,
          action:
            next === 'HIDDEN' ? 'exhibitor_publication.hidden' : 'exhibitor_publication.shown',
          entityType: 'exhibitor_photo',
          entityId: photoId,
          before: { status: row.status },
          after: { status: next },
        });
      }
      return this.viewOf({ ...row, status: next });
    });
  }

  private async assertEvent(tx: Transaction, eventId: string): Promise<void> {
    const [row] = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, eventId));
    if (!row) throw new NotFoundException(EVENT_NOT_FOUND);
  }

  private async viewOf(row: Row): Promise<OrganizerPublication> {
    const url = await this.storage.presignDownload({
      key: row.storageKey,
      fileName: row.kind === 'VIDEO' ? 'video' : 'foto',
      contentType: row.contentType,
      expiresInSeconds: PHOTO_URL_TTL_SECONDS,
      inline: true,
    });
    return {
      id: row.id,
      status: row.status as 'READY' | 'HIDDEN',
      kind: row.kind,
      caption: row.caption,
      durationS: row.durationS,
      exhibitorName: row.exhibitorName,
      url,
    };
  }
}

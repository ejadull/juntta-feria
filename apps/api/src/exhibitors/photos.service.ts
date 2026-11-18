import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DatabaseService, type Transaction } from '../db/database.service.js';
import {
  eventStands,
  events,
  exhibitorPhotos,
  exhibitors,
  reservations,
} from '../db/schema.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../storage/object-storage.js';
import { AuditService } from '../tenancy/audit.service.js';
import { UPLOAD_URL_TTL_SECONDS } from './document-policy.js';
import type { RequestPhotoInput } from './photo.input.js';
import {
  MAX_PHOTOS_PER_EXHIBITOR,
  MAX_PUBLICATIONS_PER_EVENT,
  PHOTO_URL_TTL_SECONDS,
  canPublishInEvent,
  photoKey,
  validateMediaUpload,
  type MediaKind,
} from './photo-policy.js';

const view = {
  id: exhibitorPhotos.id,
  status: exhibitorPhotos.status,
  kind: exhibitorPhotos.kind,
  contentType: exhibitorPhotos.contentType,
  sizeBytes: exhibitorPhotos.sizeBytes,
  alt: exhibitorPhotos.alt,
  caption: exhibitorPhotos.caption,
  durationS: exhibitorPhotos.durationS,
  eventId: exhibitorPhotos.eventId,
  position: exhibitorPhotos.position,
};

type PhotoRow = {
  id: string;
  status: string;
  kind: MediaKind;
  contentType: string;
  sizeBytes: number;
  alt: string | null;
  caption: string | null;
  durationS: number | null;
  eventId: string | null;
  position: number;
};

/** Never includes the storage key: `url` is a short-lived presigned GET. */
export type ExhibitorPhoto = PhotoRow & { url: string };

export type PhotoUploadTicket = {
  photo: PhotoRow;
  upload: {
    url: string;
    method: 'PUT';
    headers: Readonly<Record<string, string>>;
    expiresAt: Date;
  };
};

type ApiLimit = { readonly message: string; readonly code: string };

const NO_PROFILE = 'You have no exhibitor profile in this organization yet.';
const NOT_FOUND = 'Photo not found.';
const PROFILE_LIMIT: ApiLimit = {
  message: `An exhibitor can have at most ${MAX_PHOTOS_PER_EXHIBITOR} profile photos.`,
  code: 'PHOTO_LIMIT',
};
const PUBLICATION_LIMIT: ApiLimit = {
  message: `An exhibitor can publish at most ${MAX_PUBLICATIONS_PER_EVENT} items per event.`,
  code: 'PUBLICATION_LIMIT',
};
const NO_STAND_IN_EVENT: ApiLimit = {
  message: 'You can only publish about an event where you hold a confirmed stand.',
  code: 'NO_STAND_IN_EVENT',
};
const EVENT_CLOSED: ApiLimit = {
  message: 'This event has already ended.',
  code: 'EVENT_CLOSED',
};

/**
 * The exhibitor's own media: profile photos (no event) and publications (an event, a caption and,
 * for videos, a duration). The browser uploads straight to storage with presigned URLs.
 */
@Injectable()
export class ExhibitorPhotosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Profile photos and the publications the exhibitor has not removed (hidden ones are marked). */
  listOwn(tenantId: string, userId: string): Promise<ExhibitorPhoto[]> {
    return this.database.withTenant(tenantId, async (tx) => {
      const exhibitorId = await this.ownExhibitorId(tx, userId);
      const rows = await tx
        .select({ ...view, storageKey: exhibitorPhotos.storageKey })
        .from(exhibitorPhotos)
        .where(
          and(
            eq(exhibitorPhotos.exhibitorId, exhibitorId),
            inArray(exhibitorPhotos.status, ['READY', 'HIDDEN']),
          ),
        )
        .orderBy(asc(exhibitorPhotos.position), asc(exhibitorPhotos.createdAt));
      return Promise.all(rows.map((row) => this.withUrl(row)));
    });
  }

  requestUpload(
    tenantId: string,
    userId: string,
    input: RequestPhotoInput,
  ): Promise<PhotoUploadTicket> {
    return this.database.withTenant(tenantId, async (tx) => {
      const exhibitorId = await this.ownExhibitorId(tx, userId);
      const kind: MediaKind = input.contentType.startsWith('video/')
        ? 'VIDEO'
        : 'IMAGE';
      if (input.eventId) {
        await this.assertCanPublish(tx, exhibitorId, input.eventId);
        const used = await this.publicationCount(tx, exhibitorId, input.eventId);
        if (!canPublishInEvent(used))
          throw new ConflictException(PUBLICATION_LIMIT);
      } else if ((await this.profileCount(tx, exhibitorId)) >= MAX_PHOTOS_PER_EXHIBITOR)
        throw new ConflictException(PROFILE_LIMIT);
      const id = crypto.randomUUID();
      const storageKey = photoKey(tenantId, exhibitorId, id);
      await tx.insert(exhibitorPhotos).values({
        id,
        exhibitorId,
        kind,
        eventId: input.eventId ?? null,
        caption: input.caption ?? null,
        durationS: input.durationS ?? null,
        storageKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        alt: input.alt ?? null,
        position: await this.nextPosition(tx, exhibitorId),
      });
      const signed = await this.storage.presignUpload({
        key: storageKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      });
      const [photo] = await tx
        .select(view)
        .from(exhibitorPhotos)
        .where(eq(exhibitorPhotos.id, id));
      return {
        photo,
        upload: {
          url: signed.url,
          method: 'PUT' as const,
          headers: signed.headers,
          expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
        },
      };
    });
  }

  /** Confirms by asking the storage what it really holds; anything off is deleted. */
  async complete(
    tenantId: string,
    userId: string,
    photoId: string,
  ): Promise<ExhibitorPhoto> {
    let limit: ApiLimit | null = null;
    const result = await this.database.withTenant(tenantId, async (tx) => {
      const exhibitorId = await this.ownExhibitorId(tx, userId);
      const photo = await this.stored(tx, exhibitorId, photoId);
      if (photo.status === 'READY') return this.withUrl(photo);
      const object = await this.storage.head(photo.storageKey);
      if (!object)
        throw new ConflictException({
          message: 'The file was not uploaded yet.',
          code: 'UPLOAD_MISSING',
        });
      const observedType = object.contentType.toLowerCase();
      const check = validateMediaUpload({
        kind: photo.kind,
        contentType: observedType,
        sizeBytes: object.sizeBytes,
        caption: photo.caption,
        eventId: photo.eventId,
        durationS: photo.durationS,
      });
      const valid =
        check.ok &&
        observedType === photo.contentType &&
        (photo.eventId === null || (await this.isOpen(tx, photo.eventId)));
      const full = await this.isFull(tx, exhibitorId, photo.eventId);
      if (!valid || full) {
        await this.storage.remove(photo.storageKey);
        await tx.delete(exhibitorPhotos).where(eq(exhibitorPhotos.id, photoId));
        if (valid && full)
          limit = photo.eventId === null ? PROFILE_LIMIT : PUBLICATION_LIMIT;
        return null;
      }
      await tx
        .update(exhibitorPhotos)
        .set({ status: 'READY', sizeBytes: object.sizeBytes })
        .where(eq(exhibitorPhotos.id, photoId));
      const after = await this.stored(tx, exhibitorId, photoId);
      await this.audit.record(tx, {
        actorId: userId,
        action: 'exhibitor_photo.uploaded',
        entityType: 'exhibitor_photo',
        entityId: photoId,
        after: {
          kind: after.kind,
          contentType: after.contentType,
          sizeBytes: after.sizeBytes,
        },
      });
      return this.withUrl(after);
    });
    if (limit) throw new ConflictException(limit);
    if (!result)
      throw new UnprocessableEntityException({
        message:
          'The uploaded file does not match the allowed type, size or event.',
        code: 'UPLOAD_REJECTED',
      });
    return result;
  }

  /** Edits the text of one of the exhibitor's publications while its event is still running. */
  updateCaption(
    tenantId: string,
    userId: string,
    photoId: string,
    caption: string,
  ): Promise<ExhibitorPhoto> {
    return this.database.withTenant(tenantId, async (tx) => {
      const exhibitorId = await this.ownExhibitorId(tx, userId);
      const photo = await this.stored(tx, exhibitorId, photoId);
      if (photo.eventId === null)
        throw new ConflictException({
          message: 'Profile photos have no text to edit.',
          code: 'NOT_A_PUBLICATION',
        });
      if (!(await this.isOpen(tx, photo.eventId)))
        throw new ConflictException(EVENT_CLOSED);
      await tx
        .update(exhibitorPhotos)
        .set({ caption })
        .where(eq(exhibitorPhotos.id, photoId));
      return this.withUrl({ ...photo, caption });
    });
  }

  removeOwn(tenantId: string, userId: string, photoId: string): Promise<void> {
    return this.database.withTenant(tenantId, async (tx) => {
      const exhibitorId = await this.ownExhibitorId(tx, userId);
      const photo = await this.stored(tx, exhibitorId, photoId);
      await tx.delete(exhibitorPhotos).where(eq(exhibitorPhotos.id, photoId));
      await this.storage.remove(photo.storageKey);
      await this.audit.record(tx, {
        actorId: userId,
        action: 'exhibitor_photo.deleted',
        entityType: 'exhibitor_photo',
        entityId: photoId,
        before: {
          kind: photo.kind,
          contentType: photo.contentType,
          sizeBytes: photo.sizeBytes,
        },
      });
    });
  }

  // ---- internals ---------------------------------------------------------------------------

  private async withUrl(
    row: PhotoRow & { storageKey: string },
  ): Promise<ExhibitorPhoto> {
    const { storageKey, ...rest } = row;
    const url = await this.storage.presignDownload({
      key: storageKey,
      fileName: 'foto',
      contentType: rest.contentType,
      expiresInSeconds: PHOTO_URL_TTL_SECONDS,
      inline: true,
    });
    return { ...rest, url };
  }

  private async stored(tx: Transaction, exhibitorId: string, photoId: string) {
    const [row] = await tx
      .select({ ...view, storageKey: exhibitorPhotos.storageKey })
      .from(exhibitorPhotos)
      .where(
        and(
          eq(exhibitorPhotos.id, photoId),
          eq(exhibitorPhotos.exhibitorId, exhibitorId),
        ),
      )
      .for('update');
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  /** The exhibitor must hold a confirmed stand in the event; RLS keeps the join inside the tenant. */
  private async assertCanPublish(
    tx: Transaction,
    exhibitorId: string,
    eventId: string,
  ): Promise<void> {
    const [row] = await tx
      .select({ endsAt: events.endsAt })
      .from(events)
      .innerJoin(eventStands, eq(eventStands.eventId, events.id))
      .innerJoin(reservations, eq(reservations.eventStandId, eventStands.id))
      .where(
        and(
          eq(events.id, eventId),
          eq(reservations.exhibitorId, exhibitorId),
          eq(reservations.status, 'CONFIRMED'),
        ),
      )
      .limit(1);
    if (!row) throw new ForbiddenException(NO_STAND_IN_EVENT);
    if (row.endsAt.getTime() <= Date.now())
      throw new ConflictException(EVENT_CLOSED);
  }

  private async isOpen(tx: Transaction, eventId: string): Promise<boolean> {
    const [row] = await tx
      .select({ endsAt: events.endsAt })
      .from(events)
      .where(eq(events.id, eventId));
    return row !== undefined && row.endsAt.getTime() > Date.now();
  }

  /** Publications count against the event limit while they exist, pending ones included. */
  private async publicationCount(
    tx: Transaction,
    exhibitorId: string,
    eventId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(exhibitorPhotos)
      .where(
        and(
          eq(exhibitorPhotos.exhibitorId, exhibitorId),
          eq(exhibitorPhotos.eventId, eventId),
          inArray(exhibitorPhotos.status, ['PENDING', 'READY', 'HIDDEN']),
        ),
      );
    return row.n;
  }

  /** Full when the limit of the photo's own scope (its event, or the profile) is already READY. */
  private async isFull(
    tx: Transaction,
    exhibitorId: string,
    eventId: string | null,
  ): Promise<boolean> {
    if (eventId !== null) {
      const [row] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(exhibitorPhotos)
        .where(
          and(
            eq(exhibitorPhotos.exhibitorId, exhibitorId),
            eq(exhibitorPhotos.eventId, eventId),
            inArray(exhibitorPhotos.status, ['READY', 'HIDDEN']),
          ),
        );
      return !canPublishInEvent(row.n);
    }
    return (
      (await this.profileCount(tx, exhibitorId)) >= MAX_PHOTOS_PER_EXHIBITOR
    );
  }

  private async profileCount(
    tx: Transaction,
    exhibitorId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(exhibitorPhotos)
      .where(
        and(
          eq(exhibitorPhotos.exhibitorId, exhibitorId),
          isNull(exhibitorPhotos.eventId),
          eq(exhibitorPhotos.status, 'READY'),
        ),
      );
    return row.n;
  }

  private async nextPosition(
    tx: Transaction,
    exhibitorId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({
        n: sql<number>`coalesce(max(${exhibitorPhotos.position}) + 1, 0)::int`,
      })
      .from(exhibitorPhotos)
      .where(eq(exhibitorPhotos.exhibitorId, exhibitorId));
    return row.n;
  }

  private async ownExhibitorId(
    tx: Transaction,
    userId: string,
  ): Promise<string> {
    const [row] = await tx
      .select({ id: exhibitors.id })
      .from(exhibitors)
      .where(eq(exhibitors.userId, userId));
    if (!row) throw new NotFoundException(NO_PROFILE);
    return row.id;
  }
}

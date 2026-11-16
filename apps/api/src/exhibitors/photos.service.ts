import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DatabaseService, type Transaction } from '../db/database.service.js';
import { exhibitorPhotos, exhibitors } from '../db/schema.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../storage/object-storage.js';
import { AuditService } from '../tenancy/audit.service.js';
import { UPLOAD_URL_TTL_SECONDS } from './document-policy.js';
import type { RequestPhotoInput } from './photo.input.js';
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_EXHIBITOR,
  PHOTO_URL_TTL_SECONDS,
  photoKey,
} from './photo-policy.js';

const view = {
  id: exhibitorPhotos.id,
  status: exhibitorPhotos.status,
  contentType: exhibitorPhotos.contentType,
  sizeBytes: exhibitorPhotos.sizeBytes,
  alt: exhibitorPhotos.alt,
  position: exhibitorPhotos.position,
};

type PhotoRow = {
  id: string;
  status: string;
  contentType: string;
  sizeBytes: number;
  alt: string | null;
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

const NO_PROFILE = 'You have no exhibitor profile in this organization yet.';
const NOT_FOUND = 'Photo not found.';
const LIMIT_REACHED = {
  message: `An exhibitor can have at most ${MAX_PHOTOS_PER_EXHIBITOR} photos.`,
  code: 'PHOTO_LIMIT',
};

/** Photos of the exhibitor's own stand; uploaded straight to storage with presigned URLs. */
@Injectable()
export class ExhibitorPhotosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  listOwn(tenantId: string, userId: string): Promise<ExhibitorPhoto[]> {
    return this.database.withTenant(tenantId, async (tx) => {
      const exhibitorId = await this.ownExhibitorId(tx, userId);
      const rows = await tx
        .select({ ...view, storageKey: exhibitorPhotos.storageKey })
        .from(exhibitorPhotos)
        .where(
          and(
            eq(exhibitorPhotos.exhibitorId, exhibitorId),
            eq(exhibitorPhotos.status, 'READY'),
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
      if ((await this.readyCount(tx, exhibitorId)) >= MAX_PHOTOS_PER_EXHIBITOR)
        throw new ConflictException(LIMIT_REACHED);
      const id = crypto.randomUUID();
      const storageKey = photoKey(tenantId, exhibitorId, id);
      await tx.insert(exhibitorPhotos).values({
        id,
        exhibitorId,
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
    let rejection: 'invalid' | 'limit' | null = null;
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
      const valid =
        object.sizeBytes > 0 &&
        object.sizeBytes <= MAX_PHOTO_BYTES &&
        object.contentType.toLowerCase() === photo.contentType;
      const full =
        (await this.readyCount(tx, exhibitorId)) >= MAX_PHOTOS_PER_EXHIBITOR;
      if (!valid || full) {
        await this.storage.remove(photo.storageKey);
        await tx.delete(exhibitorPhotos).where(eq(exhibitorPhotos.id, photoId));
        rejection = valid ? 'limit' : 'invalid';
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
        after: { contentType: after.contentType, sizeBytes: after.sizeBytes },
      });
      return this.withUrl(after);
    });
    if (rejection === 'limit') throw new ConflictException(LIMIT_REACHED);
    if (!result)
      throw new UnprocessableEntityException({
        message: 'The uploaded file does not match the allowed type or size.',
        code: 'UPLOAD_REJECTED',
      });
    return result;
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
        before: { contentType: photo.contentType, sizeBytes: photo.sizeBytes },
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

  private async readyCount(
    tx: Transaction,
    exhibitorId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(exhibitorPhotos)
      .where(
        and(
          eq(exhibitorPhotos.exhibitorId, exhibitorId),
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

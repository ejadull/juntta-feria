import { isUuid } from '../db/database.service.js';

/** Stand photos: what the browser may upload, checked on presign and again by HEAD on complete. */
export const PHOTO_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS_PER_EXHIBITOR = 6;
/** Photos are shown on a page that caches the map for 15 s, so an hour is plenty. */
export const PHOTO_URL_TTL_SECONDS = 3600;

/** Server-chosen key, always under the owner's tenant and exhibitor (ids must be UUIDs). */
export function photoKey(
  tenantId: string,
  exhibitorId: string,
  photoId: string,
): string {
  for (const id of [tenantId, exhibitorId, photoId])
    if (!isUuid(id))
      throw new Error('Invalid photo key part: expected a UUID.');
  return `tenants/${tenantId}/exhibitors/${exhibitorId}/photos/${photoId}`;
}

/*
 * Publications (change exh-media-share). Videos are accepted only in the formats browsers play
 * without conversion; the browser proves it by decoding the file, the server checks the MIME type.
 */
export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/webm'] as const;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;
export const MAX_CAPTION_LENGTH = 200;
export const MAX_PUBLICATIONS_PER_EVENT = 10;

export type MediaKind = 'IMAGE' | 'VIDEO';
export type MediaRejection = 'FORMAT' | 'SIZE' | 'DURATION' | 'CAPTION' | 'EVENT';
export type MediaCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: MediaRejection; readonly message: string };

export interface MediaUploadDraft {
  readonly kind: MediaKind;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly caption: string | null;
  readonly eventId: string | null;
  readonly durationS: number | null;
}

const reject = (reason: MediaRejection, message: string): MediaCheck => ({
  ok: false,
  reason,
  message,
});

function checkFile(draft: MediaUploadDraft): MediaCheck {
  if (draft.kind === 'IMAGE') {
    if (!(PHOTO_CONTENT_TYPES as readonly string[]).includes(draft.contentType))
      return reject('FORMAT', 'Las imágenes tienen que ser JPG, PNG o WebP.');
    if (draft.sizeBytes > MAX_PHOTO_BYTES)
      return reject('SIZE', 'Una imagen pesa como máximo 5 MB.');
    if (draft.durationS !== null)
      return reject('DURATION', 'Una imagen no tiene duración.');
    return { ok: true };
  }
  if (!(VIDEO_CONTENT_TYPES as readonly string[]).includes(draft.contentType))
    return reject(
      'FORMAT',
      'Este video no se puede reproducir en los navegadores; subí un MP4 H.264 o un WebM.',
    );
  if (draft.sizeBytes > MAX_VIDEO_BYTES)
    return reject('SIZE', 'Un video pesa como máximo 50 MB.');
  if (
    draft.durationS === null ||
    draft.durationS < 1 ||
    draft.durationS > MAX_VIDEO_SECONDS
  )
    return reject('DURATION', 'Un video dura entre 1 y 60 segundos.');
  return { ok: true };
}

/** Checks one publication before it is uploaded (browser) and again when it is confirmed (API). */
export function validateMediaUpload(draft: MediaUploadDraft): MediaCheck {
  const file = checkFile(draft);
  if (!file.ok) return file;
  if (draft.caption !== null && [...draft.caption].length > MAX_CAPTION_LENGTH)
    return reject(
      'CAPTION',
      `El texto puede tener hasta ${MAX_CAPTION_LENGTH} caracteres.`,
    );
  if (draft.eventId === null && (draft.kind === 'VIDEO' || draft.caption !== null))
    return reject('EVENT', 'Las publicaciones pertenecen a un evento.');
  return { ok: true };
}

/** An exhibitor may publish up to the limit per event; the count is the publications already there. */
export function canPublishInEvent(publicationsInEvent: number): boolean {
  return publicationsInEvent < MAX_PUBLICATIONS_PER_EVENT;
}

/**
 * The status an organizer's hide or show leaves a publication in (MED-11). Only published items
 * change: a pending upload is not visible yet, so it is refused (null), and the answer for a status
 * that is already the requested one is that same status.
 */
export function visibilityAfter(
  status: string,
  hidden: boolean,
): 'READY' | 'HIDDEN' | null {
  if (status !== 'READY' && status !== 'HIDDEN') return null;
  return hidden ? 'HIDDEN' : 'READY';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a publication of an event that ended at `endsAt` must be deleted now (MED-12). With the
 * default of 0 days it is due as soon as the event ends; a longer period is set by the owner of the
 * platform once the legal review of retention is done.
 */
export function isRetentionDue(endsAt: Date, retentionDays: number, now: Date): boolean {
  return now.getTime() >= endsAt.getTime() + retentionDays * DAY_MS;
}

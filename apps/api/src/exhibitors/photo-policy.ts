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

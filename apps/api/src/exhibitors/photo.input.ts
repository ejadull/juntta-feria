import { z } from 'zod';
import { MAX_PHOTO_BYTES, PHOTO_CONTENT_TYPES } from './photo-policy.js';

/** What the exhibitor declares before uploading; the storage enforces type and size on the PUT. */
export const requestPhotoInput = z.strictObject({
  contentType: z.enum(PHOTO_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_PHOTO_BYTES),
  alt: z.string().trim().min(1).max(120).optional(),
});
export type RequestPhotoInput = z.infer<typeof requestPhotoInput>;

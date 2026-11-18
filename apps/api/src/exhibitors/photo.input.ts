import { z } from 'zod';
import {
  MAX_CAPTION_LENGTH,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  PHOTO_CONTENT_TYPES,
  VIDEO_CONTENT_TYPES,
  validateMediaUpload,
} from './photo-policy.js';

const CONTENT_TYPES = [...PHOTO_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES] as const;

/**
 * What the exhibitor declares before uploading; the storage enforces type and size on the PUT.
 * Profile photos carry `alt` only. Publications (change exh-media-share) carry an event, an optional
 * caption and, for videos, the declared duration. The rules are the shared ones in photo-policy.
 */
export const requestPhotoInput = z
  .strictObject({
    contentType: z.enum(CONTENT_TYPES),
    sizeBytes: z.number().int().min(1).max(MAX_VIDEO_BYTES),
    alt: z.string().trim().min(1).max(120).optional(),
    caption: z.string().trim().min(1).max(MAX_CAPTION_LENGTH).optional(),
    eventId: z.uuid().optional(),
    durationS: z.number().int().min(1).max(MAX_VIDEO_SECONDS).optional(),
  })
  .superRefine((input, ctx) => {
    const kind = input.contentType.startsWith('video/') ? 'VIDEO' : 'IMAGE';
    const check = validateMediaUpload({
      kind,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      caption: input.caption ?? null,
      eventId: input.eventId ?? null,
      durationS: input.durationS ?? null,
    });
    if (!check.ok) ctx.addIssue({ code: 'custom', message: check.message, path: [] });
  });
export type RequestPhotoInput = z.infer<typeof requestPhotoInput>;

/** Only the text of a publication can change; the file and its event are fixed at upload. */
export const updateCaptionInput = z.strictObject({
  caption: z.string().trim().min(1).max(MAX_CAPTION_LENGTH),
});

import { z } from 'zod';
import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
} from './document-policy.js';

/** What the exhibitor declares before uploading; the storage enforces type and size on the PUT. */
export const requestUploadInput = z.strictObject({
  type: z.enum(DOCUMENT_TYPES),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(DOCUMENT_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
});
export type RequestUploadInput = z.infer<typeof requestUploadInput>;

/** A rejection must say why, so the exhibitor knows what to fix. */
export const reviewInput = z
  .strictObject({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => v.decision === 'APPROVED' || v.reason !== undefined, {
    path: ['reason'],
    message: 'is required to reject',
  });
export type ReviewInput = z.infer<typeof reviewInput>;

export const categoryInput = z.strictObject({
  name: z.string().trim().min(1).max(60),
});
export type CategoryInput = z.infer<typeof categoryInput>;

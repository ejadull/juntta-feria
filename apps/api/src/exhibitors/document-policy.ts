import { isUuid } from '../db/database.service.js';

/**
 * EXH-03 rules for exhibitor documents. The spec fixes no document types, so this is a small
 * allow-list; the organizer decides per case what is acceptable.
 */
export const DOCUMENT_TYPES = [
  'CONSTANCIA_AFIP',
  'SEGURO',
  'HABILITACION',
  'OTRO',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Aggregate shown in the organizer list; MISSING means nothing was uploaded yet. */
export type DocumentsStatus = 'MISSING' | DocumentStatus;

/** Uploads are validated against this allow-list when presigning and again by HEAD on complete. */
export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const UPLOAD_URL_TTL_SECONDS = 300;
export const DOWNLOAD_URL_TTL_SECONDS = 60;

/**
 * Server-chosen object key, always under the owner's tenant and exhibitor so a key of another
 * tenant can never be produced from request data (ids must be UUIDs).
 */
export function documentKey(
  tenantId: string,
  exhibitorId: string,
  documentId: string,
): string {
  for (const id of [tenantId, exhibitorId, documentId])
    if (!isUuid(id))
      throw new Error('Invalid document key part: expected a UUID.');
  return `tenants/${tenantId}/exhibitors/${exhibitorId}/documents/${documentId}`;
}

/**
 * One status for the exhibitor: a rejection needs the exhibitor's action, so it wins over
 * pending reviews, which win over an all-approved set.
 */
export function deriveDocumentsStatus(
  statuses: readonly DocumentStatus[],
): DocumentsStatus {
  if (statuses.length === 0) return 'MISSING';
  if (statuses.includes('REJECTED')) return 'REJECTED';
  if (statuses.includes('PENDING')) return 'PENDING';
  return 'APPROVED';
}

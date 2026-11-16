import type { Observable } from 'rxjs';

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoContentType = (typeof PHOTO_TYPES)[number];
/** Same limits as the API (photo-policy.ts); the API enforces them again with a HEAD on complete. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 6;

/** A stand photo of the signed-in exhibitor. `url` is a short-lived signed link; no storage key. */
export interface ExhibitorPhotoDto {
  readonly id: string;
  readonly status: 'PENDING' | 'READY';
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly alt: string | null;
  readonly position: number;
  readonly url: string;
}

export interface PhotoUploadRequest {
  readonly contentType: PhotoContentType;
  readonly sizeBytes: number;
  readonly alt?: string;
}

/** `POST /exhibitors/me/photos`: where and how the browser must PUT the file. */
export interface PhotoUploadTicketDto {
  readonly photo: Omit<ExhibitorPhotoDto, 'url'>;
  readonly upload: {
    readonly url: string;
    readonly method: 'PUT';
    readonly headers: Readonly<Record<string, string>>;
    readonly expiresAt: string;
  };
}

/**
 * Port for the signed-in exhibitor's own stand photos. Also the DI token. Failures are the API's
 * HTTP errors (409 `PHOTO_LIMIT`, 409 `UPLOAD_MISSING`, 422 `UPLOAD_REJECTED`, 404).
 */
export abstract class ExhibitorPhotosRepository {
  abstract list(): Observable<readonly ExhibitorPhotoDto[]>;
  abstract requestUpload(request: PhotoUploadRequest): Observable<PhotoUploadTicketDto>;
  abstract complete(id: string): Observable<ExhibitorPhotoDto>;
  abstract remove(id: string): Observable<void>;
}

import type { Observable } from 'rxjs';

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const VIDEO_TYPES = ['video/mp4', 'video/webm'] as const;
export type PhotoContentType = (typeof PHOTO_TYPES)[number] | (typeof VIDEO_TYPES)[number];
/** Same limits as the API (photo-policy.ts); the API enforces them again with a HEAD on complete. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 6;

/**
 * Media of the signed-in exhibitor: profile photos (no event) and publications (an event, a caption
 * and, for videos, a duration). `url` is a short-lived signed link; no storage key.
 */
export interface ExhibitorPhotoDto {
  readonly id: string;
  readonly status: 'PENDING' | 'READY' | 'HIDDEN';
  readonly kind: 'IMAGE' | 'VIDEO';
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly alt: string | null;
  readonly caption: string | null;
  readonly durationS: number | null;
  readonly eventId: string | null;
  readonly position: number;
  readonly url: string;
}

export interface PhotoUploadRequest {
  readonly contentType: PhotoContentType;
  readonly sizeBytes: number;
  readonly alt?: string;
  readonly eventId?: string;
  readonly caption?: string;
  readonly durationS?: number;
}

/** An event where the exhibitor holds a confirmed stand, so it may publish about it. */
export interface ExhibitorEventOption {
  readonly id: string;
  readonly name: string;
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
 * Port for the signed-in exhibitor's own media. Also the DI token. Failures are the API's HTTP
 * errors (409 `PHOTO_LIMIT`, 409 `PUBLICATION_LIMIT`, 403 `NO_STAND_IN_EVENT`, 409 `EVENT_CLOSED`,
 * 409 `UPLOAD_MISSING`, 422 `UPLOAD_REJECTED`, 404).
 */
export abstract class ExhibitorPhotosRepository {
  abstract list(): Observable<readonly ExhibitorPhotoDto[]>;
  abstract requestUpload(request: PhotoUploadRequest): Observable<PhotoUploadTicketDto>;
  abstract complete(id: string): Observable<ExhibitorPhotoDto>;
  abstract remove(id: string): Observable<void>;
  abstract updateCaption(id: string, caption: string): Observable<ExhibitorPhotoDto>;
  /** Events where the exhibitor holds a confirmed stand. */
  abstract myEvents(): Observable<readonly ExhibitorEventOption[]>;
}

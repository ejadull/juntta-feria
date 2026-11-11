import type { Observable } from 'rxjs';

/** EXH-03: the spec fixes no document types, so the API keeps this short allow-list. */
export type DocumentType = 'CONSTANCIA_AFIP' | 'SEGURO' | 'HABILITACION' | 'OTRO';
export type DocumentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** A confirmed document of an exhibitor. The storage key never reaches the client. */
export interface ExhibitorDocumentDto {
  readonly id: string;
  readonly exhibitorId: string;
  readonly type: DocumentType;
  readonly status: DocumentStatus;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number | null;
  readonly uploadedAt: string | null;
  readonly reviewedAt: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: string;
}

export interface UploadRequest {
  readonly type: DocumentType;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

/** `POST /exhibitors/me/documents`: where and how the browser must PUT the file. */
export interface UploadTicketDto {
  readonly document: ExhibitorDocumentDto;
  readonly upload: {
    readonly url: string;
    readonly method: 'PUT';
    readonly headers: Readonly<Record<string, string>>;
    readonly expiresAt: string;
  };
}

/** A short-lived signed URL; the browser leaves the app for it and the file downloads. */
export interface DownloadTicketDto {
  readonly url: string;
  readonly fileName: string;
  readonly expiresAt: string;
}

export type ReviewDecision =
  { readonly decision: 'APPROVED' } | { readonly decision: 'REJECTED'; readonly reason: string };

/**
 * Port for the signed-in exhibitor's own documents. Also the DI token. Failures are the API's HTTP
 * errors (409 `UPLOAD_MISSING`, 422 `UPLOAD_REJECTED`, 409 `DOCUMENT_APPROVED`, 404).
 */
export abstract class OwnDocumentsRepository {
  abstract list(): Observable<readonly ExhibitorDocumentDto[]>;
  abstract requestUpload(request: UploadRequest): Observable<UploadTicketDto>;
  abstract complete(id: string): Observable<ExhibitorDocumentDto>;
  abstract remove(id: string): Observable<void>;
  abstract download(id: string): Observable<DownloadTicketDto>;
}

/** Port for organizers reviewing the documents of an exhibitor of their organization. */
export abstract class DocumentReviewRepository {
  abstract list(exhibitorId: string): Observable<readonly ExhibitorDocumentDto[]>;
  abstract download(exhibitorId: string, documentId: string): Observable<DownloadTicketDto>;
  abstract review(
    exhibitorId: string,
    documentId: string,
    decision: ReviewDecision,
  ): Observable<ExhibitorDocumentDto>;
}

/**
 * Sends the file straight to the signed URL (never through the API). Emits the percentage sent
 * (0 to 100) and completes when the storage accepted the file.
 */
export abstract class FileUploader {
  abstract put(
    target: { readonly url: string; readonly headers: Readonly<Record<string, string>> },
    file: Blob,
  ): Observable<number>;
}

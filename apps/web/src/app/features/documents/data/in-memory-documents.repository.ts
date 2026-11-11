import { defer, of, throwError, type Observable } from 'rxjs';
import { httpError } from '../../../shared/http-error';
import {
  DocumentReviewRepository,
  FileUploader,
  OwnDocumentsRepository,
  type DownloadTicketDto,
  type ExhibitorDocumentDto,
  type ReviewDecision,
  type UploadRequest,
  type UploadTicketDto,
} from './document.repository';

const NOW = '2026-11-10T12:00:00Z';

/**
 * Both ports over one list, like the API: what the exhibitor uploads (after `complete`) is what
 * the organizer reviews. Test double only.
 */
export class InMemoryDocuments {
  private rows: ExhibitorDocumentDto[];
  private pending = new Map<string, ExhibitorDocumentDto>();
  private next = 1;

  constructor(seed: readonly ExhibitorDocumentDto[] = []) {
    this.rows = [...seed];
  }

  all(): readonly ExhibitorDocumentDto[] {
    return this.rows;
  }

  readonly own: OwnDocumentsRepository = {
    list: () => defer(() => of([...this.rows])),
    requestUpload: (request: UploadRequest): Observable<UploadTicketDto> =>
      defer(() => {
        const document: ExhibitorDocumentDto = {
          id: `doc-${this.next++}`,
          exhibitorId: 'me',
          type: request.type,
          status: 'PENDING',
          fileName: request.fileName,
          contentType: request.contentType,
          sizeBytes: request.sizeBytes,
          uploadedAt: null,
          reviewedAt: null,
          rejectionReason: null,
          createdAt: NOW,
        };
        this.pending.set(document.id, document);
        return of({
          document,
          upload: {
            url: `https://storage.test/upload/${document.id}`,
            method: 'PUT' as const,
            headers: { 'Content-Type': request.contentType },
            expiresAt: NOW,
          },
        });
      }),
    complete: (id: string) =>
      defer(() => {
        const document = this.pending.get(id);
        if (!document) return throwError(() => httpError(404));
        const done = { ...document, uploadedAt: NOW };
        this.pending.delete(id);
        this.rows = [...this.rows, done];
        return of(done);
      }),
    remove: (id: string) =>
      defer(() => {
        const found = this.rows.find((d) => d.id === id);
        if (!found) return throwError(() => httpError(404));
        if (found.status === 'APPROVED')
          return throwError(() => httpError(409, { code: 'DOCUMENT_APPROVED' }));
        this.rows = this.rows.filter((d) => d.id !== id);
        return of(undefined);
      }),
    download: (id: string) => this.ticket(id),
  };

  readonly review: DocumentReviewRepository = {
    list: (exhibitorId: string) =>
      defer(() => of(this.rows.filter((d) => d.exhibitorId === exhibitorId))),
    download: (_exhibitorId: string, documentId: string) => this.ticket(documentId),
    review: (
      _exhibitorId: string,
      documentId: string,
      decision: ReviewDecision,
    ): Observable<ExhibitorDocumentDto> =>
      defer(() => {
        const found = this.rows.find((d) => d.id === documentId);
        if (!found) return throwError(() => httpError(404));
        const reviewed: ExhibitorDocumentDto = {
          ...found,
          status: decision.decision,
          reviewedAt: NOW,
          rejectionReason: decision.decision === 'REJECTED' ? decision.reason : null,
        };
        this.rows = this.rows.map((d) => (d.id === documentId ? reviewed : d));
        return of(reviewed);
      }),
  };

  private ticket(id: string): Observable<DownloadTicketDto> {
    return defer(() => {
      const found = this.rows.find((d) => d.id === id);
      return found
        ? of({
            url: `https://storage.test/download/${id}`,
            fileName: found.fileName,
            expiresAt: NOW,
          })
        : throwError(() => httpError(404));
    });
  }
}

/** Uploader double: reports 50 % and 100 % unless told to fail. */
export class InMemoryFileUploader extends FileUploader {
  readonly sent: { url: string; headers: Readonly<Record<string, string>>; size: number }[] = [];
  failWith: unknown = null;

  put(
    target: { readonly url: string; readonly headers: Readonly<Record<string, string>> },
    file: Blob,
  ): Observable<number> {
    return defer(() => {
      if (this.failWith) return throwError(() => this.failWith);
      this.sent.push({ url: target.url, headers: target.headers, size: file.size });
      return of(50, 100);
    });
  }
}

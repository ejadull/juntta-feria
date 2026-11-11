import { HttpClient, HttpEventType } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { filter, map, type Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
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

const enc = encodeURIComponent;

/** The exhibitor's own documents through the API (EXH-03). */
@Injectable()
export class HttpOwnDocumentsRepository extends OwnDocumentsRepository {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/exhibitors/me/documents`;

  list(): Observable<readonly ExhibitorDocumentDto[]> {
    return this.http.get<readonly ExhibitorDocumentDto[]>(this.url);
  }

  requestUpload(request: UploadRequest): Observable<UploadTicketDto> {
    return this.http.post<UploadTicketDto>(this.url, request);
  }

  complete(id: string): Observable<ExhibitorDocumentDto> {
    return this.http.post<ExhibitorDocumentDto>(`${this.url}/${enc(id)}/complete`, {});
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${enc(id)}`);
  }

  download(id: string): Observable<DownloadTicketDto> {
    return this.http.get<DownloadTicketDto>(`${this.url}/${enc(id)}/download`);
  }
}

/** Organizer review of an exhibitor's documents through the API (OWNER, ADMIN and OPERATOR). */
@Injectable()
export class HttpDocumentReviewRepository extends DocumentReviewRepository {
  private readonly http = inject(HttpClient);

  list(exhibitorId: string): Observable<readonly ExhibitorDocumentDto[]> {
    return this.http.get<readonly ExhibitorDocumentDto[]>(this.base(exhibitorId));
  }

  download(exhibitorId: string, documentId: string): Observable<DownloadTicketDto> {
    return this.http.get<DownloadTicketDto>(
      `${this.base(exhibitorId)}/${enc(documentId)}/download`,
    );
  }

  review(
    exhibitorId: string,
    documentId: string,
    decision: ReviewDecision,
  ): Observable<ExhibitorDocumentDto> {
    return this.http.post<ExhibitorDocumentDto>(
      `${this.base(exhibitorId)}/${enc(documentId)}/review`,
      decision,
    );
  }

  private base(exhibitorId: string): string {
    return `${API_BASE}/exhibitors/${enc(exhibitorId)}/documents`;
  }
}

/**
 * PUT to the presigned URL. The URL is not under API_BASE, so the auth interceptor leaves it
 * alone: a bearer token or tenant header would break the signature (and the bucket's CORS).
 */
@Injectable()
export class HttpFileUploader extends FileUploader {
  private readonly http = inject(HttpClient);

  put(
    target: { readonly url: string; readonly headers: Readonly<Record<string, string>> },
    file: Blob,
  ): Observable<number> {
    return this.http
      .put(target.url, file, {
        headers: { ...target.headers },
        observe: 'events',
        reportProgress: true,
        responseType: 'text',
      })
      .pipe(
        map((event) => {
          if (event.type === HttpEventType.UploadProgress)
            return event.total ? Math.min(99, Math.round((100 * event.loaded) / event.total)) : 0;
          return event.type === HttpEventType.Response ? 100 : null;
        }),
        filter((percent): percent is number => percent !== null),
      );
  }
}

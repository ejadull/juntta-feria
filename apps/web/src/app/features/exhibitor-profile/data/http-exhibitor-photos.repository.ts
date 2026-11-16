import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import {
  ExhibitorPhotosRepository,
  type ExhibitorPhotoDto,
  type PhotoUploadRequest,
  type PhotoUploadTicketDto,
} from './exhibitor-photos.repository';

/** The exhibitor's own stand photos through the API. */
@Injectable()
export class HttpExhibitorPhotosRepository extends ExhibitorPhotosRepository {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/exhibitors/me/photos`;

  list(): Observable<readonly ExhibitorPhotoDto[]> {
    return this.http.get<readonly ExhibitorPhotoDto[]>(this.url);
  }

  requestUpload(request: PhotoUploadRequest): Observable<PhotoUploadTicketDto> {
    return this.http.post<PhotoUploadTicketDto>(this.url, request);
  }

  complete(id: string): Observable<ExhibitorPhotoDto> {
    return this.http.post<ExhibitorPhotoDto>(`${this.url}/${encodeURIComponent(id)}/complete`, {});
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`);
  }
}

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, forkJoin, map, of, type Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import {
  ExhibitorPhotosRepository,
  type ExhibitorEventOption,
  type ExhibitorPhotoDto,
  type PhotoUploadRequest,
  type PhotoUploadTicketDto,
} from './exhibitor-photos.repository';

/** A reservation as the API lists it to the exhibitor (only what the event picker needs). */
interface OwnReservation {
  readonly status: string;
  readonly eventId: string;
}

/** The exhibitor's own media through the API. */
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

  updateCaption(id: string, caption: string): Observable<ExhibitorPhotoDto> {
    return this.http.patch<ExhibitorPhotoDto>(`${this.url}/${encodeURIComponent(id)}`, { caption });
  }

  /** Confirmed reservations, named with the events list; without names the picker still works. */
  myEvents(): Observable<readonly ExhibitorEventOption[]> {
    return forkJoin({
      reservations: this.http.get<readonly OwnReservation[]>(`${API_BASE}/reservations`),
      events: this.http
        .get<readonly { id: string; name: string }[]>(`${API_BASE}/events`)
        .pipe(catchError(() => of([]))),
    }).pipe(
      map(({ reservations, events }) => {
        const names = new Map(events.map((e) => [e.id, e.name]));
        const ids = [
          ...new Set(reservations.filter((r) => r.status === 'CONFIRMED').map((r) => r.eventId)),
        ];
        return ids.map((id) => ({ id, name: names.get(id) ?? 'Feria' }));
      }),
    );
  }
}

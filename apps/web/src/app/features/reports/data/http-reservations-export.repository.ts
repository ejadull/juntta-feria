import { HttpClient, type HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import { ReservationsExportRepository, type ExportFile } from './reservations-export.repository';

const FILENAME = /filename="?([^";]+)"?/i;

/**
 * Downloads through HttpClient (blob) because only HttpClient calls carry the Authorization and
 * X-Tenant-Id headers; a plain link would not.
 */
@Injectable()
export class HttpReservationsExportRepository extends ReservationsExportRepository {
  private readonly http = inject(HttpClient);

  download(eventId: string): Observable<ExportFile> {
    return this.http
      .get(`${API_BASE}/events/${encodeURIComponent(eventId)}/reservations/export`, {
        observe: 'response',
        responseType: 'blob',
      })
      .pipe(
        map((response: HttpResponse<Blob>) => ({
          filename: this.filenameOf(response, eventId),
          blob: response.body ?? new Blob([], { type: 'text/csv' }),
        })),
      );
  }

  private filenameOf(response: HttpResponse<Blob>, eventId: string): string {
    const named = FILENAME.exec(response.headers.get('Content-Disposition') ?? '')?.[1];
    return named ?? `reservas-${eventId}.csv`;
  }
}

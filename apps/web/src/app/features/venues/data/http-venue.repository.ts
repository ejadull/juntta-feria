import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import { VenueRepository, type VenueDto, type VenueInput } from './venue.repository';

/** VEN-01 through the API (tenant and token come from the interceptor). */
@Injectable()
export class HttpVenueRepository extends VenueRepository {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/venues`;

  list(): Observable<readonly VenueDto[]> {
    return this.http.get<readonly VenueDto[]>(this.url);
  }

  create(input: VenueInput): Observable<VenueDto> {
    return this.http.post<VenueDto>(this.url, input);
  }

  update(id: string, input: VenueInput): Observable<VenueDto> {
    return this.http.patch<VenueDto>(`${this.url}/${encodeURIComponent(id)}`, input);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`);
  }
}

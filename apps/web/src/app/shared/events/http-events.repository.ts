import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE } from '../api/api-base';
import { EventsRepository, type OrganizerEvent } from './events.repository';

/** EVT-01 through the API (tenant and token come from the interceptor). */
@Injectable()
export class HttpEventsRepository extends EventsRepository {
  private readonly http = inject(HttpClient);

  list(): Observable<readonly OrganizerEvent[]> {
    return this.http.get<readonly OrganizerEvent[]>(`${API_BASE}/events`);
  }
}

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, throwError, type Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import { issuesOf, problemOf } from '../../../shared/auth/problem';
import {
  EventAdminRepository,
  EventPublishRejectedError,
  type CreateEventInput,
  type EventDto,
  type UpdateEventInput,
} from './event-admin.repository';

/** EVT-01 events through the API (tenant and token come from the interceptor). */
@Injectable()
export class HttpEventAdminRepository extends EventAdminRepository {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/events`;

  list(): Observable<readonly EventDto[]> {
    return this.http.get<readonly EventDto[]>(this.url);
  }

  get(id: string): Observable<EventDto> {
    return this.http.get<EventDto>(this.eventUrl(id));
  }

  create(input: CreateEventInput): Observable<EventDto> {
    return this.http.post<EventDto>(this.url, input);
  }

  update(id: string, patch: UpdateEventInput): Observable<EventDto> {
    return this.http.patch<EventDto>(this.eventUrl(id), patch);
  }

  publish(id: string): Observable<EventDto> {
    return this.http.post<EventDto>(`${this.eventUrl(id)}/publish`, {}).pipe(
      catchError((error: unknown) => {
        const issues = problemOf(error).status === 422 ? issuesOf(error) : [];
        return throwError(() =>
          issues.length > 0 ? new EventPublishRejectedError(issues) : error,
        );
      }),
    );
  }

  private eventUrl(id: string): string {
    return `${this.url}/${encodeURIComponent(id)}`;
  }
}

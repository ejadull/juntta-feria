import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, throwError, type Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import { problemOf } from '../../../shared/auth/problem';
import {
  EventMetricsRepository,
  EventNotFoundError,
  type EventMetricsDto,
} from './event-metrics.repository';

/** Window of the monthly series requested from the API (`days`, 1..MAX_METRIC_DAYS server side). */
export const METRICS_DAYS = 30;

/** REP-01 through the API (staff only; tenant and token come from the interceptor). */
@Injectable()
export class HttpEventMetricsRepository extends EventMetricsRepository {
  private readonly http = inject(HttpClient);

  get(eventId: string): Observable<EventMetricsDto> {
    return this.http
      .get<EventMetricsDto>(`${API_BASE}/events/${encodeURIComponent(eventId)}/metrics`, {
        params: { days: METRICS_DAYS },
      })
      .pipe(
        catchError((error: unknown) =>
          throwError(() =>
            problemOf(error).status === 404 ? new EventNotFoundError(eventId) : error,
          ),
        ),
      );
  }
}

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, map, of, type Observable } from 'rxjs';
import { API_BASE } from './api-base';

export type ApiStatus = 'up' | 'down';

/** Minimal connectivity probe (FND-05): liveness through the app's own origin. Never errors. */
@Injectable({ providedIn: 'root' })
export class ApiStatusService {
  private readonly http = inject(HttpClient);

  check(): Observable<ApiStatus> {
    return this.http.get<unknown>(`${API_BASE}/health/live`).pipe(
      // A dev-server HTML fallback would also be a 200: require the liveness body.
      map((body): ApiStatus => ((body as { status?: unknown })?.status === 'ok' ? 'up' : 'down')),
      catchError(() => of<ApiStatus>('down')),
    );
  }
}

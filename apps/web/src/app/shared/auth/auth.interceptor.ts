import { HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { API_BASE } from '../api/api-base';
import { SessionStore } from './session.store';

export const TENANT_HEADER = 'X-Tenant-Id';
const AUTH_PREFIX = `${API_BASE}/auth/`;
/** Routes that are not scoped to an organization (global per user, public or infrastructure). */
const NO_TENANT = [
  AUTH_PREFIX,
  `${API_BASE}/public/`,
  `${API_BASE}/health`,
  `${API_BASE}/me/subscription`,
];

function authorized(request: HttpRequest<unknown>, session: SessionStore): HttpRequest<unknown> {
  const token = session.accessToken();
  const tenantId = session.tenantId();
  const scoped = !NO_TENANT.some((prefix) => request.url.startsWith(prefix));
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (token && tenantId && scoped) headers[TENANT_HEADER] = tenantId;
  return request.clone({ setHeaders: headers });
}

/**
 * Adds the bearer token and the organization header to API calls. A 401 renews the session once
 * (single-flight in the store) and retries; if that fails the user goes back to sign in.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(API_BASE)) return next(request);
  if (request.url.startsWith(AUTH_PREFIX)) return next(request.clone({ withCredentials: true }));

  const session = inject(SessionStore);
  const router = inject(Router);
  return next(authorized(request, session)).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || !session.user())
        return throwError(() => error);
      return session.refresh().pipe(
        switchMap((renewed) => {
          if (renewed) return next(authorized(request, session));
          void router.navigate(['/ingresar'], { queryParams: { volver: router.url } });
          return throwError(() => error);
        }),
      );
    }),
  );
};

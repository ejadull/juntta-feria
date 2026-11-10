import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, of, shareReplay, type Observable } from 'rxjs';
import { API_BASE } from '../api/api-base';

/** `GET /auth/providers` (CORE-05): what the sign-in pages may offer. */
export interface AuthProvidersDto {
  readonly google: { readonly clientId: string } | null;
}

/** The Google client id comes from the API, so the web needs no build-time configuration. */
@Injectable({ providedIn: 'root' })
export class AuthProviders {
  private readonly http = inject(HttpClient);

  /** The Google client id, or null when it is not configured or the API did not answer. */
  readonly googleClientId$: Observable<string | null> = this.http
    .get<AuthProvidersDto>(`${API_BASE}/auth/providers`)
    .pipe(
      map((providers) => providers.google?.clientId ?? null),
      catchError(() => of(null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
}

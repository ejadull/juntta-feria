import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, finalize, map, of, shareReplay, tap, type Observable } from 'rxjs';
import { API_BASE } from '../api/api-base';

export type MembershipRole = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'EXHIBITOR';

export interface MembershipDto {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly tenantName: string;
  readonly role: MembershipRole;
}

/** `POST /auth/login` and `POST /auth/refresh` (CORE-02): the refresh token only travels in a cookie. */
export interface SessionDto {
  readonly accessToken: string;
  readonly user: { readonly id: string; readonly email: string };
  readonly memberships: readonly MembershipDto[];
}

/**
 * Who is signed in. The access token lives only in this object's memory (never in web storage):
 * a reload gets a new one through the HttpOnly refresh cookie (`restore`).
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly http = inject(HttpClient);
  private readonly session = signal<SessionDto | null>(null);
  private readonly chosenTenant = signal<string | null>(null);
  private inflight: Observable<boolean> | null = null;

  readonly user = computed(() => this.session()?.user ?? null);
  readonly memberships = computed(() => this.session()?.memberships ?? []);
  /** The organization sent as `X-Tenant-Id`: the chosen one, else the exhibitor's, else the first. */
  readonly tenantId = computed(() => {
    const all = this.memberships();
    const chosen = this.chosenTenant();
    return (
      (all.find((m) => m.tenantId === chosen) ?? all.find((m) => m.role === 'EXHIBITOR') ?? all[0])
        ?.tenantId ?? null
    );
  });

  accessToken(): string | null {
    return this.session()?.accessToken ?? null;
  }

  selectTenant(tenantId: string): void {
    this.chosenTenant.set(tenantId);
  }

  login(email: string, password: string): Observable<void> {
    return this.http.post<SessionDto>(`${API_BASE}/auth/login`, { email, password }).pipe(
      tap((session) => this.session.set(session)),
      map(() => undefined),
    );
  }

  /** Same session as `login`, from a Google ID token (CORE-05). */
  loginWithGoogle(credential: string): Observable<void> {
    return this.http.post<SessionDto>(`${API_BASE}/auth/google`, { credential }).pipe(
      tap((session) => this.session.set(session)),
      map(() => undefined),
    );
  }

  /** Renews the session with the cookie. One request at a time, however many callers (single-flight). */
  refresh(): Observable<boolean> {
    this.inflight ??= this.http.post<SessionDto>(`${API_BASE}/auth/refresh`, {}).pipe(
      tap((session) => this.session.set(session)),
      map(() => true),
      catchError(() => {
        this.session.set(null);
        return of(false);
      }),
      finalize(() => (this.inflight = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.inflight;
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${API_BASE}/auth/logout`, {}).pipe(
      catchError(() => of(undefined)),
      tap(() => {
        this.session.set(null);
        this.chosenTenant.set(null);
      }),
      map(() => undefined),
    );
  }

  /** App start: picks up a previous session if the cookie is still valid. Never rejects. */
  restore(): Promise<void> {
    return new Promise((resolve) => this.refresh().subscribe({ complete: resolve }));
  }
}

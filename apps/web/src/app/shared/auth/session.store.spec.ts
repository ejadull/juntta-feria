import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SessionStore, type SessionDto } from './session.store';

const SESSION: SessionDto = {
  accessToken: 'access-1',
  user: { id: 'u1', email: 'feriante@example.test' },
  memberships: [
    { tenantId: 't-owner', tenantSlug: 'a', tenantName: 'A', role: 'OWNER' },
    { tenantId: 't-exh', tenantSlug: 'b', tenantName: 'B', role: 'EXHIBITOR' },
  ],
};

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { store: TestBed.inject(SessionStore), http: TestBed.inject(HttpTestingController) };
}

describe('SessionStore (CORE-02, P01)', () => {
  it('keeps the access token in memory only, never in web storage', () => {
    const { store, http } = setup();
    store.loginWithGoogle('id-token').subscribe();
    const req = http.expectOne('/api/v1/auth/google');
    expect(req.request.body).toEqual({ credential: 'id-token' });
    req.flush(SESSION);

    expect(store.accessToken()).toBe('access-1');
    expect(store.user()?.email).toBe('feriante@example.test');
    expect(JSON.stringify({ ...localStorage })).not.toContain('access-1');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('access-1');
  });

  it('picks the exhibitor organization by itself and lets the user change it', () => {
    const { store, http } = setup();
    store.loginWithGoogle('id-token').subscribe();
    http.expectOne('/api/v1/auth/google').flush(SESSION);
    expect(store.tenantId()).toBe('t-exh');
    store.selectTenant('t-owner');
    expect(store.tenantId()).toBe('t-owner');
    store.selectTenant('not-a-membership');
    expect(store.tenantId()).toBe('t-exh');
  });

  it('derives the area from the role in the active organization', () => {
    const { store, http } = setup();
    expect(store.area()).toBe('visitante');
    store.loginWithGoogle('id-token').subscribe();
    http.expectOne('/api/v1/auth/google').flush(SESSION);
    expect(store.area()).toBe('feriante');
    store.selectTenant('t-owner');
    expect(store.area()).toBe('organizador');
  });

  it('refreshes with one request however many callers ask (single-flight)', () => {
    const { store, http } = setup();
    const results: boolean[] = [];
    store.refresh().subscribe((ok) => results.push(ok));
    store.refresh().subscribe((ok) => results.push(ok));
    http.expectOne('/api/v1/auth/refresh').flush({ ...SESSION, accessToken: 'access-2' });

    expect(results).toEqual([true, true]);
    expect(store.accessToken()).toBe('access-2');

    // Once settled, the next refresh is a new request.
    store.refresh().subscribe();
    http.expectOne('/api/v1/auth/refresh').flush({ ...SESSION, accessToken: 'access-3' });
    expect(store.accessToken()).toBe('access-3');
  });

  it('ends up signed out when the refresh cookie is not valid', async () => {
    const { store, http } = setup();
    const restored = store.restore();
    http
      .expectOne('/api/v1/auth/refresh')
      .flush({ detail: 'Session expired' }, { status: 401, statusText: 'Unauthorized' });
    await restored;
    expect(store.user()).toBeNull();
    expect(store.accessToken()).toBeNull();
  });

  it('forgets everything on logout, even if the server cannot be reached', () => {
    const { store, http } = setup();
    store.loginWithGoogle('id-token').subscribe();
    http.expectOne('/api/v1/auth/google').flush(SESSION);
    store.logout().subscribe();
    http.expectOne('/api/v1/auth/logout').error(new ProgressEvent('error'));
    expect(store.user()).toBeNull();
    expect(store.tenantId()).toBeNull();
  });
});

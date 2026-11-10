import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { SessionStore, type SessionDto } from './session.store';

const session = (accessToken: string): SessionDto => ({
  accessToken,
  user: { id: 'u1', email: 'feriante@example.test' },
  memberships: [{ tenantId: 'tenant-1', tenantSlug: 'a', tenantName: 'A', role: 'EXHIBITOR' }],
});

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  const store = TestBed.inject(SessionStore);
  const http = TestBed.inject(HttpTestingController);
  store.loginWithGoogle('id-token').subscribe();
  http.expectOne('/api/v1/auth/google').flush(session('access-1'));
  return { store, http, client: TestBed.inject(HttpClient) };
}

describe('authInterceptor (CORE-02)', () => {
  it('adds the bearer token and the organization to tenant routes', () => {
    const { http, client } = setup();
    client.get('/api/v1/reservations').subscribe();
    const req = http.expectOne('/api/v1/reservations');
    expect(req.request.headers.get('Authorization')).toBe('Bearer access-1');
    expect(req.request.headers.get('X-Tenant-Id')).toBe('tenant-1');
  });

  it('does not send the organization to routes that are global per user', () => {
    const { http, client } = setup();
    client.get('/api/v1/me/subscription').subscribe();
    const req = http.expectOne('/api/v1/me/subscription');
    expect(req.request.headers.get('Authorization')).toBe('Bearer access-1');
    expect(req.request.headers.has('X-Tenant-Id')).toBe(false);
  });

  it('sends the cookie, and no token, to the auth routes', () => {
    const { http, client } = setup();
    client.post('/api/v1/auth/refresh', {}).subscribe();
    const req = http.expectOne('/api/v1/auth/refresh');
    expect(req.request.withCredentials).toBe(true);
    expect(req.request.headers.has('Authorization')).toBe(false);
  });

  it('leaves other origins alone', () => {
    const { http, client } = setup();
    client.get('https://sdk.mercadopago.com/js/v2').subscribe();
    const req = http.expectOne('https://sdk.mercadopago.com/js/v2');
    expect(req.request.headers.has('Authorization')).toBe(false);
  });

  it('renews the session once for several 401s and retries each request', () => {
    const { http, client } = setup();
    const answers: unknown[] = [];
    client.get('/api/v1/reservations').subscribe((r) => answers.push(r));
    client.get('/api/v1/events').subscribe((r) => answers.push(r));
    const unauthorized = { status: 401, statusText: 'Unauthorized' };
    http.expectOne('/api/v1/reservations').flush({}, unauthorized);
    http.expectOne('/api/v1/events').flush({}, unauthorized);

    http.expectOne('/api/v1/auth/refresh').flush(session('access-2'));
    const retries = http.match((r) => r.headers.get('Authorization') === 'Bearer access-2');
    expect(retries.map((r) => r.request.url).sort()).toEqual([
      '/api/v1/events',
      '/api/v1/reservations',
    ]);
    retries.forEach((r) => r.flush(['ok']));
    expect(answers).toEqual([['ok'], ['ok']]);
  });

  it('sends the user back to sign in when the session cannot be renewed', () => {
    const { http, client } = setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    let failed = false;
    client.get('/api/v1/reservations').subscribe({ error: () => (failed = true) });
    http.expectOne('/api/v1/reservations').flush({}, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/v1/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(failed).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/ingresar'], expect.anything());
  });

  it('does not retry other failures', () => {
    const { http, client } = setup();
    let status = 0;
    client.get('/api/v1/reservations').subscribe({ error: (e) => (status = e.status) });
    http.expectOne('/api/v1/reservations').flush({}, { status: 409, statusText: 'Conflict' });
    expect(status).toBe(409);
    http.verify();
  });
});

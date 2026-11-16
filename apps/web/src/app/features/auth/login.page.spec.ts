import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { GOOGLE_SIGN_IN, type GoogleButtonOptions } from '../../shared/google-sign-in';
import { LoginPage } from './login.page';

const EXHIBITOR_ORG = { tenantId: 't', tenantSlug: 'org', tenantName: 'Org', role: 'EXHIBITOR' };
const SESSION = {
  accessToken: 'a',
  user: { id: 'u', email: 'f@example.test' },
  memberships: [EXHIBITOR_ORG],
};
const STAFF_SESSION = { ...SESSION, memberships: [{ ...EXHIBITOR_ORG, role: 'OWNER' }] };

/** A fake GIS: remembers the options so the test can play "the user picked an account". */
async function render(providers: object, volver?: string) {
  const rendered: { container: HTMLElement; options: GoogleButtonOptions }[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: GOOGLE_SIGN_IN,
        useValue: async (container: HTMLElement, options: GoogleButtonOptions) => {
          rendered.push({ container, options });
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(LoginPage);
  if (volver) fixture.componentRef.setInput('volver', volver);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  http.expectOne('/api/v1/auth/providers').flush(providers);
  await fixture.whenStable();
  await fixture.whenStable();
  return { host: fixture.nativeElement as HTMLElement, rendered, http, fixture };
}

describe('LoginPage (P01, CORE-05)', () => {
  it('has no email or password form: Google is the only way in', async () => {
    const { host } = await render({ google: { clientId: 'cid.test' } });
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('input')).toBeNull();
    expect(host.textContent).toContain('Ingresá con tu cuenta de Google');
    expect(host.textContent).toContain('Pedile una invitación a tu organizador');
  });

  it('shows a labelled Google button', async () => {
    const { rendered } = await render({ google: { clientId: 'cid.test' } });
    expect(rendered).toHaveLength(1);
    expect(rendered[0].options).toMatchObject({ clientId: 'cid.test', text: 'signin_with' });
    expect(rendered[0].container.getAttribute('aria-label')).toBe('Ingresar con Google');
    expect(rendered[0].container.getAttribute('role')).toBe('group');
  });

  it('says Google sign-in is unavailable when the API has no client id', async () => {
    const { host, rendered } = await render({ google: null });
    expect(host.querySelector('app-google-sign-in-button')).toBeNull();
    expect(rendered).toHaveLength(0);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('no está disponible');
  });

  it('signs in with the credential and follows the `volver` redirect', async () => {
    const { rendered, http } = await render(
      { google: { clientId: 'cid.test' } },
      '/feriante/reservas',
    );
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    rendered[0].options.onCredential('id-token');
    const req = http.expectOne('/api/v1/auth/google');
    expect(req.request.body).toEqual({ credential: 'id-token' });
    req.flush(SESSION);
    expect(navigate).toHaveBeenCalledWith('/feriante/reservas');
  });

  it('never follows an absolute return URL', async () => {
    const { rendered, http } = await render(
      { google: { clientId: 'cid.test' } },
      'https://evil.test',
    );
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    rendered[0].options.onCredential('id-token');
    http.expectOne('/api/v1/auth/google').flush(SESSION);
    expect(navigate).toHaveBeenCalledWith('/feriante/explorar');
  });

  it('lands staff on their own home when there is no `volver`', async () => {
    const { rendered, http } = await render({ google: { clientId: 'cid.test' } });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    rendered[0].options.onCredential('id-token');
    http.expectOne('/api/v1/auth/google').flush(STAFF_SESSION);
    expect(navigate).toHaveBeenCalledWith('/organizador/panel');
  });

  it.each([
    [403, 'GOOGLE_ACCOUNT_NOT_REGISTERED', 'Pedile una invitación al organizador'],
    [401, 'GOOGLE_ACCOUNT_MISMATCH', 'vinculada a otra cuenta de Google'],
    [401, 'GOOGLE_CREDENTIAL_INVALID', 'No pudimos verificar tu cuenta de Google'],
    [503, 'GOOGLE_SIGN_IN_UNAVAILABLE', 'no está disponible'],
    [429, undefined, 'demasiados intentos'],
  ])('explains %i %s in friendly words', async (status, code, text) => {
    const { host, rendered, http, fixture } = await render({
      google: { clientId: 'cid.test' },
    });
    rendered[0].options.onCredential('id-token');
    http
      .expectOne('/api/v1/auth/google')
      .flush({ detail: 'x', ...(code ? { code } : {}) }, { status, statusText: 'x' });
    await fixture.whenStable();
    const message = host.querySelector('[role="alert"]')?.textContent;
    expect(message).toContain(text);
    expect(message).not.toContain('contraseña');
  });
});

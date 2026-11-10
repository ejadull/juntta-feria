import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { GOOGLE_SIGN_IN, type GoogleButtonOptions } from '../../shared/google-sign-in';
import { LoginPage } from './login.page';

const SESSION = {
  accessToken: 'a',
  user: { id: 'u', email: 'f@example.test' },
  memberships: [],
};

async function render(volver?: string) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(LoginPage);
  if (volver) fixture.componentRef.setInput('volver', volver);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const type = (id: string, value: string) => {
    const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
  };
  return { host, type, submit, http: TestBed.inject(HttpTestingController), fixture };
}

describe('LoginPage (P01)', () => {
  it('labels both fields and uses the autofill hints', async () => {
    const { host } = await render();
    expect(host.querySelector('label[for="email"]')?.textContent).toContain('Correo');
    expect(host.querySelector('label[for="password"]')?.textContent).toContain('Contraseña');
    expect(host.querySelector('#email')?.getAttribute('autocomplete')).toBe('username');
    expect(host.querySelector('#password')?.getAttribute('autocomplete')).toBe('current-password');
  });

  it('signs in and goes back to where the user was heading', async () => {
    const { type, submit, http } = await render('/feriante/reservas');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    type('email', ' f@example.test ');
    type('password', 'secret');
    await submit();
    const req = http.expectOne('/api/v1/auth/login');
    expect(req.request.body).toEqual({ email: 'f@example.test', password: 'secret' });
    req.flush(SESSION);
    expect(navigate).toHaveBeenCalledWith('/feriante/reservas');
  });

  it('never follows an absolute return URL', async () => {
    const { type, submit, http } = await render('https://evil.test');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    type('email', 'f@example.test');
    type('password', 'secret');
    await submit();
    http.expectOne('/api/v1/auth/login').flush(SESSION);
    expect(navigate).toHaveBeenCalledWith('/feriante/explorar');
  });

  it.each([
    [401, 'no son correctos'],
    [429, 'demasiados intentos'],
    [503, 'no está disponible'],
  ])('explains a %i answer in friendly words', async (status, text) => {
    const { host, type, submit, http, fixture } = await render();
    type('email', 'f@example.test');
    type('password', 'bad');
    await submit();
    http.expectOne('/api/v1/auth/login').flush({ detail: 'x' }, { status, statusText: 'x' });
    await fixture.whenStable();
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(text);
    expect(host.querySelector('#email')?.getAttribute('aria-describedby')).toBe('login-error');
  });

  it('asks for both fields before calling the API', async () => {
    const { host, submit, http } = await render();
    await submit();
    http.expectNone('/api/v1/auth/login');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Revisá');
  });
});

describe('LoginPage with Google (CORE-05)', () => {
  /** A fake GIS: remembers the options so the test can play "the user picked an account". */
  async function renderWithGoogle(providers: object, volver?: string) {
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

  it('hides the button when the API has no Google client id', async () => {
    const { host, rendered } = await renderWithGoogle({ google: null });
    expect(host.querySelector('app-google-sign-in-button')).toBeNull();
    expect(rendered).toHaveLength(0);
    expect(host.querySelector('form')).not.toBeNull();
  });

  it('shows a labelled Google button below the form, with the "o" separator', async () => {
    const { host, rendered } = await renderWithGoogle({ google: { clientId: 'cid.test' } });
    expect(rendered).toHaveLength(1);
    expect(rendered[0].options).toMatchObject({ clientId: 'cid.test', text: 'signin_with' });
    expect(rendered[0].container.getAttribute('aria-label')).toBe('Ingresar con Google');
    expect(rendered[0].container.getAttribute('role')).toBe('group');
    expect(host.textContent).toContain('o');
    expect(host.querySelector('#email')).not.toBeNull(); // the email form stays usable
  });

  it('signs in with the credential and follows the same `volver` redirect', async () => {
    const { rendered, http } = await renderWithGoogle(
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

  it.each([
    [403, 'GOOGLE_ACCOUNT_NOT_REGISTERED', 'Pedile una invitación al organizador'],
    [401, 'GOOGLE_ACCOUNT_MISMATCH', 'vinculada a otra cuenta de Google'],
    [401, 'GOOGLE_CREDENTIAL_INVALID', 'No pudimos verificar tu cuenta de Google'],
    [503, 'GOOGLE_SIGN_IN_UNAVAILABLE', 'no está disponible'],
    [429, undefined, 'demasiados intentos'],
  ])('explains %i %s in friendly words', async (status, code, text) => {
    const { host, rendered, http, fixture } = await renderWithGoogle({
      google: { clientId: 'cid.test' },
    });
    rendered[0].options.onCredential('id-token');
    http
      .expectOne('/api/v1/auth/google')
      .flush({ detail: 'x', ...(code ? { code } : {}) }, { status, statusText: 'x' });
    await fixture.whenStable();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(text);
  });
});

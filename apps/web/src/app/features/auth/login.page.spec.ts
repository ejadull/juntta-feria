import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
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

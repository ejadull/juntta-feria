import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { GOOGLE_SIGN_IN, type GoogleButtonOptions } from '../../shared/google-sign-in';
import { InvitationPage } from './invitation.page';

const SESSION = { accessToken: 'a', user: { id: 'u', email: 'n@example.test' }, memberships: [] };
const INVITATION = { organizationName: 'Feria Norte', email: 'n@example.test', name: 'Nora' };
const TOKEN = 'T'.repeat(43);
const INVITATION_URL = `/api/v1/public/invitations/${TOKEN}`;

async function render(googleClientId: string | null = 'cid.test') {
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
  const fixture = TestBed.createComponent(InvitationPage);
  fixture.componentRef.setInput('token', TOKEN);
  await fixture.whenStable();
  const http = TestBed.inject(HttpTestingController);
  const host = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    await fixture.whenStable();
  };
  const open = async (invitation: object | null = INVITATION) => {
    http
      .expectOne('/api/v1/auth/providers')
      .flush({ google: googleClientId ? { clientId: googleClientId } : null });
    const req = http.expectOne(INVITATION_URL);
    if (invitation) req.flush(invitation);
    else req.flush({ detail: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle();
  };
  const type = (id: string, value: string) => {
    const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  return { host, http, rendered, open, type, submit, settle };
}

describe('InvitationPage (EXH-04, CORE-05)', () => {
  it('shows the organization, prefilled and locked to the invited email', async () => {
    const { host, open } = await render();
    await open();
    expect(host.textContent).toContain('Feria Norte');
    expect(host.querySelector<HTMLInputElement>('#email')!.value).toBe('n@example.test');
    expect(host.querySelector<HTMLInputElement>('#email')!.readOnly).toBe(true);
    expect(host.querySelector<HTMLInputElement>('#fullName')!.value).toBe('Nora');
    expect(host.querySelector('#password')?.getAttribute('autocomplete')).toBe('new-password');
  });

  it('explains an invalid, used or expired link', async () => {
    const { host, open } = await render();
    await open(null);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('no es válido');
    expect(host.querySelector('form')).toBeNull();
  });

  it('creates the account with a password, signs in and enters the exhibitor area', async () => {
    const { http, open, type, submit } = await render(null);
    await open();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    type('password', 'una clave larga y segura');
    type('phone', '+54 9 11 2345-6789');
    await submit();

    const accept = http.expectOne(`${INVITATION_URL}/accept`);
    expect(accept.request.body).toEqual({
      fullName: 'Nora',
      email: 'n@example.test',
      password: 'una clave larga y segura',
      phone: '+54 9 11 2345-6789',
    });
    accept.flush(
      { user: { id: 'u', email: 'n@example.test' }, tenantId: 't' },
      { status: 201, statusText: 'Created' },
    );
    http.expectOne('/api/v1/auth/login').flush(SESSION);
    expect(navigate).toHaveBeenCalledWith('/feriante/explorar');
  });

  it('asks for a long enough password before calling the API', async () => {
    const { host, http, open, type, submit } = await render(null);
    await open();
    type('password', 'corta');
    await submit();
    http.expectNone(`${INVITATION_URL}/accept`);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('10 caracteres');
  });

  it('hides "Continuar con Google" when the API has no client id', async () => {
    const { host, open, rendered } = await render(null);
    await open();
    expect(host.querySelector('app-google-sign-in-button')).toBeNull();
    expect(rendered).toHaveLength(0);
  });

  it('offers a labelled "Continuar con Google" next to the password form', async () => {
    const { host, open, rendered } = await render();
    await open();
    expect(rendered).toHaveLength(1);
    expect(rendered[0].options).toMatchObject({ clientId: 'cid.test', text: 'continue_with' });
    expect(rendered[0].container.getAttribute('aria-label')).toBe('Continuar con Google');
    expect(host.querySelector('#password')).not.toBeNull();
  });

  it('accepts with the Google credential, without any password, then signs in with it', async () => {
    const { http, open, rendered } = await render();
    await open();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    rendered[0].options.onCredential('id-token');

    const accept = http.expectOne(`${INVITATION_URL}/accept`);
    expect(accept.request.body).toEqual({ googleCredential: 'id-token', fullName: 'Nora' });
    accept.flush(
      { user: { id: 'u', email: 'n@example.test' }, tenantId: 't' },
      { status: 201, statusText: 'Created' },
    );
    const login = http.expectOne('/api/v1/auth/google');
    expect(login.request.body).toEqual({ credential: 'id-token' });
    login.flush(SESSION);
    expect(navigate).toHaveBeenCalledWith('/feriante/explorar');
  });

  it.each([
    [422, 'INVITATION_EMAIL_MISMATCH', 'otro email que el de la invitación'],
    [401, 'GOOGLE_CREDENTIAL_INVALID', 'No pudimos verificar tu cuenta de Google'],
    [503, 'GOOGLE_SIGN_IN_UNAVAILABLE', 'no está disponible'],
    [409, undefined, 'Ya hay una cuenta con ese email'],
    [404, undefined, 'no es válido'],
  ])('explains %i %s in friendly words', async (status, code, text) => {
    const { host, http, open, rendered, settle } = await render();
    await open();
    rendered[0].options.onCredential('id-token');
    http
      .expectOne(`${INVITATION_URL}/accept`)
      .flush({ detail: 'x', ...(code ? { code } : {}) }, { status, statusText: 'x' });
    await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(text);
  });
});

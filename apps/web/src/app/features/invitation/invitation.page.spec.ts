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
  return { host, http, rendered, open, settle };
}

describe('InvitationPage (EXH-04, CORE-05)', () => {
  it('shows the organization and only "Continuar con Google": no password form', async () => {
    const { host, open, rendered } = await render();
    await open();
    expect(host.textContent).toContain('Feria Norte');
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('input')).toBeNull();
    expect(rendered).toHaveLength(1);
    expect(rendered[0].options).toMatchObject({ clientId: 'cid.test', text: 'continue_with' });
    expect(rendered[0].container.getAttribute('aria-label')).toBe('Continuar con Google');
  });

  it('explains an invalid, used or expired link', async () => {
    const { host, open } = await render();
    await open(null);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('no es válido');
    expect(host.querySelector('app-google-sign-in-button')).toBeNull();
  });

  it('says Google is unavailable when the API has no client id', async () => {
    const { host, open, rendered } = await render(null);
    await open();
    expect(host.querySelector('app-google-sign-in-button')).toBeNull();
    expect(rendered).toHaveLength(0);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('no está disponible');
  });

  it('accepts with the Google credential, then signs in with it', async () => {
    const { http, open, rendered } = await render();
    await open();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    rendered[0].options.onCredential('id-token');

    const accept = http.expectOne(`${INVITATION_URL}/accept`);
    expect(accept.request.body).toEqual({ googleCredential: 'id-token' });
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
    const message = host.querySelector('[role="alert"]')?.textContent;
    expect(message).toContain(text);
    expect(message).not.toContain('contraseña');
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EXTERNAL_NAVIGATION } from '../../shared/external-navigation';
import { signedInAs } from '../../shared/auth/testing';
import { SUBSCRIPTION_POLL, SubscriptionPage } from './subscription.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const URL = '/api/v1/me/subscription';
const FUTURE = new Date(Date.now() + 20 * 86_400_000).toISOString();

async function render() {
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      signedInAs('feriante@example.test'),
      { provide: EXTERNAL_NAVIGATION, useValue: navigate },
      { provide: SUBSCRIPTION_POLL, useValue: { intervalMs: 5, attempts: 4 } },
    ],
  });
  const fixture = TestBed.createComponent(SubscriptionPage);
  const http = TestBed.inject(HttpTestingController);
  const host = fixture.nativeElement as HTMLElement;
  const answer = async (body: object) => {
    await vi.waitFor(() => http.expectOne(URL).flush(body));
    await fixture.whenStable();
  };
  const button = (text: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      plain(b.textContent).includes(text),
    )!;
  const click = async (el: HTMLElement) => {
    el.click();
    await fixture.whenStable();
  };
  return { fixture, http, host, navigate, answer, button, click };
}

describe('SubscriptionPage (EXH-05)', () => {
  it('shows "Sin suscripción" with the account email prefilled and explained', async () => {
    const { host, answer } = await render();
    await answer({ status: 'NONE' });
    expect(plain(host.querySelector('[data-testid="subscription-status"]')?.textContent)).toContain(
      'Sin suscripción',
    );
    const input = host.querySelector<HTMLInputElement>('#payer-email')!;
    expect(input.value).toBe('feriante@example.test');
    expect(host.querySelector('label[for="payer-email"]')?.textContent).toContain(
      'Email de tu cuenta de Mercado Pago',
    );
    expect(input.getAttribute('aria-describedby')).toBe('payer-help');
  });

  it('starts the subscription with the typed email and sends the browser to Mercado Pago', async () => {
    const { fixture, http, host, navigate, answer } = await render();
    await answer({ status: 'NONE' });
    const input = host.querySelector<HTMLInputElement>('#payer-email')!;
    input.value = 'comprador@testuser.com';
    input.dispatchEvent(new Event('input'));
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));

    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ payerEmail: 'comprador@testuser.com' });
    expect(req.request.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    req.flush({ status: 'PENDING', initPoint: 'https://mp.test/authorize' });
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith('https://mp.test/authorize');
  });

  it.each([
    [503, {}, 'todavía no está disponible'],
    [403, { code: 'EXHIBITOR_REQUIRED' }, 'Solo las cuentas de feriante'],
  ])('explains a %i from the API', async (status, error, text) => {
    const { fixture, http, host, answer } = await render();
    await answer({ status: 'NONE' });
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectOne(URL).flush(error, { status, statusText: 'x' });
    await fixture.whenStable();
    expect(plain(host.querySelector('[role="alert"]')?.textContent)).toContain(text);
  });

  it('says an active subscription already exists and reloads the status', async () => {
    const { fixture, http, host, answer } = await render();
    await answer({ status: 'NONE' });
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    http
      .expectOne(URL)
      .flush({ code: 'SUBSCRIPTION_ALREADY_ACTIVE' }, { status: 409, statusText: 'Conflict' });
    await answer({ status: 'ACTIVE', currentPeriodEnd: FUTURE });
    await fixture.whenStable();
    expect(plain(host.textContent)).toContain('Activa hasta el');
  });

  it('waits for the webhook after coming back pending, then shows the activation', async () => {
    const { host, answer, fixture } = await render();
    await answer({ status: 'PENDING', initPoint: 'https://mp.test/authorize' });
    expect(plain(host.textContent)).toContain('Pendiente de autorización');
    expect(plain(host.textContent)).toContain('Esperamos la confirmación');

    await answer({ status: 'ACTIVE', currentPeriodEnd: FUTURE });
    expect(plain(host.querySelector('[data-testid="subscription-status"]')?.textContent)).toContain(
      `Activa hasta el ${new Date(FUTURE).toLocaleDateString('es-AR')}`,
    );
    await fixture.whenStable();
    expect(host.querySelector('#payer-email')).toBeNull();
  });

  it('lets the user check again once the polling gives up', async () => {
    const { http, host, button, click, fixture } = await render();
    for (let i = 0; i < 4; i++)
      await vi.waitFor(() => http.expectOne(URL).flush({ status: 'PENDING' }));
    await fixture.whenStable();
    await vi.waitFor(() => expect(plain(host.textContent)).toContain('Todavía no recibimos'));
    await click(button('Volver a consultar'));
    await vi.waitFor(() =>
      http.expectOne(URL).flush({ status: 'ACTIVE', currentPeriodEnd: FUTURE }),
    );
    await fixture.whenStable();
    expect(plain(host.textContent)).toContain('Activa hasta el');
  });

  it('confirms before cancelling, focusing the safe choice, and keeps access until the period ends', async () => {
    const { fixture, http, host, answer, button, click } = await render();
    await answer({ status: 'ACTIVE', currentPeriodEnd: FUTURE });
    await click(button('Cancelar suscripción'));
    const dialog = host.querySelector('[role="alertdialog"]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBe('cancel-title');
    await vi.waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Cancelar'));

    await click(button('Sí, cancelar'));
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('DELETE');
    req.flush({ status: 'CANCELLED', currentPeriodEnd: FUTURE });
    await fixture.whenStable();
    expect(plain(host.querySelector('[data-testid="subscription-status"]')?.textContent)).toContain(
      'Cancelada: sigue activa hasta el',
    );
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('shows an error and retries when the status cannot be read', async () => {
    const { http, host, button, click, fixture } = await render();
    await vi.waitFor(() => http.expectOne(URL).flush({}, { status: 500, statusText: 'Error' }));
    await fixture.whenStable();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No pudimos consultar');
    await click(button('Volver a consultar'));
    await vi.waitFor(() => http.expectOne(URL).flush({ status: 'NONE' }));
    await fixture.whenStable();
    expect(plain(host.textContent)).toContain('Sin suscripción');
  });
});

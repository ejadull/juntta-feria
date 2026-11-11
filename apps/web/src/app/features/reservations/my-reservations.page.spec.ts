import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MyReservationsPage } from './my-reservations.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const reservation = (id: string, status: string, code: string, holdMinutes: number | null) => ({
  id,
  status,
  holdExpiresAt:
    holdMinutes === null ? null : new Date(Date.now() + holdMinutes * 60_000).toISOString(),
  amount: { currency: 'ARS', valueCents: 1_740_000 },
  stand: { id: `s-${id}`, code, areaM2: 9 },
  eventId: 'e1',
});

async function render() {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(MyReservationsPage);
  await fixture.whenStable();
  return {
    fixture,
    host: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
  };
}

describe('MyReservationsPage (RES-01)', () => {
  it('lists stand, event, amount and a Spanish status, and offers to pay only the live ones', async () => {
    const { host, http, fixture } = await render();
    http
      .expectOne('/api/v1/reservations')
      .flush([
        reservation('r1', 'HELD', 'S2', 10),
        reservation('r2', 'PAYMENT_PENDING', 'S3', null),
        reservation('r3', 'CONFIRMED', 'S1', null),
        reservation('r4', 'HELD', 'S4', -5),
        reservation('r5', 'REFUND_PENDING', 'S5', null),
      ]);
    http.expectOne('/api/v1/events').flush([{ id: 'e1', name: 'Feria Sandbox' }]);
    await fixture.whenStable();

    const rows = [...host.querySelectorAll('[data-testid="reservation"]')];
    expect(rows).toHaveLength(5);
    // Live reservations first, the lapsed hold (r4) last as history.
    expect(plain(rows[0].textContent)).toContain('Stand S2');
    expect(plain(rows[0].textContent)).toContain('Feria Sandbox');
    expect(plain(rows[0].textContent)).toMatch(/\$\s?17\.400/);
    expect(plain(rows[0].textContent)).toContain('Retenida');
    expect(plain(rows[0].textContent)).toContain('Vence a las');
    expect(plain(rows[1].textContent)).toContain('Pago pendiente');
    expect(plain(rows[2].textContent)).toContain('Confirmada');
    expect(plain(rows[3].textContent)).toContain('Devolución en curso');
    expect(plain(rows[4].textContent)).toContain('Stand S4');
    expect(plain(rows[4].textContent)).toContain('Vencida');

    const pay = rows.map((r) => r.querySelector<HTMLAnchorElement>('a.btn-primary'));
    expect(pay.map((a) => a !== null)).toEqual([true, true, false, false, false]);
    expect(pay[0]?.getAttribute('href')).toBe('/feriante/reservas/nueva?reserva=r1');
    expect(rows[0].querySelector('a:not(.btn-primary)')?.getAttribute('href')).toBe(
      '/feriante/reservas/r1/pago/pendiente',
    );
  });

  it('keeps expired and cancelled reservations as history, after the active ones and without Pagar', async () => {
    const { host, http, fixture } = await render();
    http
      .expectOne('/api/v1/reservations')
      .flush([
        reservation('r1', 'EXPIRED', 'S1', null),
        reservation('r2', 'CANCELLED', 'S2', null),
        reservation('r3', 'HELD', 'S3', 10),
      ]);
    http.expectOne('/api/v1/events').flush([]);
    await fixture.whenStable();

    const rows = [...host.querySelectorAll('[data-testid="reservation"]')];
    expect(rows.map((r) => /Stand (S\d)/.exec(plain(r.textContent))?.[1])).toEqual([
      'S3',
      'S1',
      'S2',
    ]);
    expect(plain(rows[1].textContent)).toContain('Vencida');
    expect(plain(rows[2].textContent)).toContain('Cancelada');
    expect(rows[1].querySelector('a.btn-primary')).toBeNull();
    expect(rows[2].querySelector('a.btn-primary')).toBeNull();
  });

  it('does not offer Pagar when the hold lapsed but the payment is still being verified', async () => {
    const { host, http, fixture } = await render();
    http.expectOne('/api/v1/reservations').flush([reservation('r1', 'PAYMENT_PENDING', 'S1', -3)]);
    http.expectOne('/api/v1/events').flush([]);
    await fixture.whenStable();

    const row = host.querySelector('[data-testid="reservation"]') as HTMLElement;
    expect(plain(row.textContent)).toContain('Verificando el pago');
    expect(row.querySelector('a.btn-primary')).toBeNull();
  });

  it('shows an empty state that leads to the stands', async () => {
    const { host, http, fixture } = await render();
    http.expectOne('/api/v1/reservations').flush([]);
    http.expectOne('/api/v1/events').flush([]);
    await fixture.whenStable();
    expect(plain(host.textContent)).toContain('Todavía no reservaste ningún stand');
    expect(host.querySelector('a.btn-primary')?.getAttribute('href')).toBe('/feriante/explorar');
  });

  it('still lists the reservations when the event names cannot be read', async () => {
    const { host, http, fixture } = await render();
    http.expectOne('/api/v1/reservations').flush([reservation('r1', 'CONFIRMED', 'S1', null)]);
    http.expectOne('/api/v1/events').flush({}, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    expect(plain(host.textContent)).toContain('Stand S1');
  });

  it('shows an error and retries', async () => {
    const { host, http, fixture } = await render();
    http.expectOne('/api/v1/reservations').flush({}, { status: 500, statusText: 'Error' });
    http.match('/api/v1/events').forEach((r) => !r.cancelled && r.flush([]));
    await fixture.whenStable();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No pudimos cargar');

    host.querySelector<HTMLButtonElement>('button')!.click();
    http.expectOne('/api/v1/reservations').flush([]);
    http.expectOne('/api/v1/events').flush([]);
    await fixture.whenStable();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

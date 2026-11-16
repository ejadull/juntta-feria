import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import {
  ReservationPaymentRepository,
  type ReservationDto,
} from '../checkout-return/data/reservation-payment.repository';
import {
  DEMO_EVENT_SLUG,
  InMemoryPublicCatalogRepository,
} from '../public-catalog/data/in-memory-public-catalog.repository';
import { PublicCatalogRepository } from '../public-catalog/data/public-catalog.repository';
import { standsOf } from '../public-catalog/domain/stand-filters';
import { ReservationsApi } from './data/reservations.api';
import { ReservePage } from './reserve.page';

const catalog = new InMemoryPublicCatalogRepository();
const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const problem = (status: number, code?: string) =>
  throwError(() => new HttpErrorResponse({ status, error: code ? { code } : {} }));

const reservation = (patch: Partial<ReservationDto> = {}): ReservationDto => ({
  id: 'r1',
  status: 'HELD',
  holdExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  amount: { currency: 'ARS', valueCents: 1_740_000 },
  stand: { id: 'x', code: 'A02', areaM2: 9 },
  eventId: 'e1',
  ...patch,
});
const CHECKOUT = { checkoutUrl: 'https://mp.test/init', preferenceId: 'pref', wallet: null };

async function render(
  inputs: Record<string, string>,
  api: Partial<Record<keyof ReservationsApi, unknown>> = {},
  payments: Partial<ReservationPaymentRepository> = {},
) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PublicCatalogRepository, useValue: catalog },
      { provide: ReservationsApi, useValue: api },
      {
        provide: ReservationPaymentRepository,
        useValue: {
          reservation: () => of(reservation()),
          checkout: () => of(CHECKOUT),
          ...payments,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(ReservePage);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const button = (text: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      plain(b.textContent).includes(text),
    )!;
  const click = async (el: HTMLElement) => {
    el.click();
    await fixture.whenStable();
  };
  const accept = () => click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  return { host, fixture, button, accept, click };
}

async function availableStandId(): Promise<string> {
  const map = await firstValueFrom(catalog.getMap(DEMO_EVENT_SLUG));
  return standsOf(map).find((s) => s.status === 'AVAILABLE')!.id;
}

describe('ReservePage (P18, RES-01, PAY-02)', () => {
  it('summarizes the stand and needs the terms before reserving', async () => {
    const stand = await availableStandId();
    const { host, button, accept } = await render({ stand, feria: DEMO_EVENT_SLUG });
    expect(plain(host.querySelector('#summary-title')?.textContent)).toBe('Resumen');
    expect(plain(host.textContent)).toMatch(/Precio final\s*\$\s?[\d.]+/);
    expect(plain(host.textContent)).toContain('versión 2026-11');
    expect(button('Reservar y pagar').disabled).toBe(true);
    await accept();
    expect(button('Reservar y pagar').disabled).toBe(false);
  });

  it('holds the stand with the accepted terms, then opens the payment with its countdown', async () => {
    const stand = await availableStandId();
    const hold = vi.fn(() => of(reservation()));
    const checkout = vi.fn(() => of(CHECKOUT));
    const { host, button, accept, click, fixture } = await render(
      { stand, feria: DEMO_EVENT_SLUG },
      { hold },
      { checkout },
    );
    await accept();
    await click(button('Reservar y pagar'));
    await fixture.whenStable();

    expect(hold).toHaveBeenCalledWith(stand, '2026-11', expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(checkout).toHaveBeenCalledWith('r1');
    expect(host.querySelector('[data-testid="hold-clock"]')?.textContent).toMatch(/^1[45]:\d\d$/);
    expect(host.querySelector('[role="timer"]')).not.toBeNull();
    // Nothing is announced until the last two minutes.
    expect(plain(host.querySelector('[aria-live="polite"]')?.textContent)).toBe('');
    // No public key in the test API: the Wallet Brick falls back to the init_point link.
    expect(host.querySelector<HTMLAnchorElement>('a.btn-primary')?.href).toBe(
      'https://mp.test/init',
    );
  });

  it('explains that a platform subscription is needed and links to it (EXH-05)', async () => {
    const stand = await availableStandId();
    const { host, button, accept, click } = await render(
      { stand, feria: DEMO_EVENT_SLUG },
      { hold: () => problem(403, 'SUBSCRIPTION_REQUIRED') },
    );
    await accept();
    await click(button('Reservar y pagar'));
    const alert = host.querySelector('[role="alert"]')!;
    expect(plain(alert.textContent)).toContain('suscripción activa');
    expect(alert.querySelector('a')?.getAttribute('href')).toBe('/feriante/suscripcion');
  });

  it('links to Mis reservas when the hold limit is reached', async () => {
    const stand = await availableStandId();
    const { host, button, accept, click } = await render(
      { stand, feria: DEMO_EVENT_SLUG },
      { hold: () => problem(409, 'HOLD_LIMIT') },
    );
    await accept();
    await click(button('Reservar y pagar'));
    const alert = host.querySelector('[role="alert"]')!;
    expect(plain(alert.textContent)).toContain('máximo de reservas retenidas');
    expect(alert.querySelector('a')?.getAttribute('href')).toBe('/feriante/reservas');
  });

  it.each([
    [403, 'PROFILE_INCOMPLETE', 'perfil de feriante'],
    [409, 'STAND_UNAVAILABLE', 'Alguien se llevó este stand'],
    [503, undefined, 'no está disponible por un momento'],
  ])('shows a clear message for %i %s', async (status, code, text) => {
    const stand = await availableStandId();
    const { host, button, accept, click } = await render(
      { stand, feria: DEMO_EVENT_SLUG },
      { hold: () => problem(status, code) },
    );
    await accept();
    await click(button('Reservar y pagar'));
    expect(plain(host.querySelector('[role="alert"]')?.textContent)).toContain(text);
    expect(button('Reservar y pagar').disabled).toBe(false);
  });

  it('keeps the held stand and offers a retry when only the checkout fails', async () => {
    const stand = await availableStandId();
    const { host, button, accept, click } = await render(
      { stand, feria: DEMO_EVENT_SLUG },
      { hold: () => of(reservation()) },
      { checkout: () => problem(503) },
    );
    await accept();
    await click(button('Reservar y pagar'));
    expect(plain(host.textContent)).toContain('A02');
    expect(plain(host.querySelector('[role="alert"]')?.textContent)).toContain('Probá de nuevo');
    expect(button('Reintentar el pago')).toBeDefined();
  });

  it('says so when the hold has expired', async () => {
    const expired = reservation({ holdExpiresAt: new Date(Date.now() - 1000).toISOString() });
    const { host } = await render({ reserva: 'r1' }, {}, { reservation: () => of(expired) });
    expect(plain(host.querySelector('[role="alert"]')?.textContent)).toContain('venció');
  });

  describe('hold countdown', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] }));
    afterEach(() => vi.useRealTimers());

    const resumeWith = (msLeft: number) =>
      render(
        { reserva: 'r1' },
        {},
        {
          reservation: () =>
            of(reservation({ holdExpiresAt: new Date(Date.now() + msLeft).toISOString() })),
        },
      );
    const tick = async (fixture: { detectChanges(): void }, ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      fixture.detectChanges();
    };

    it('stays quiet while there is plenty of time', async () => {
      const { host } = await resumeWith(10 * 60_000);
      expect(host.querySelector('[data-testid="hold-warning"]')).toBeNull();
      expect(plain(host.querySelector('[data-testid="hold-announcement"]')?.textContent)).toBe('');
      expect(plain(host.querySelector('[data-testid="hold-clock"]')?.textContent)).toBe('10:00');
    });

    it('warns with a banner and one polite announcement in the last two minutes', async () => {
      const { host, fixture } = await resumeWith(125_000);
      expect(host.querySelector('[data-testid="hold-warning"]')).toBeNull();

      await tick(fixture, 6_000);
      const warning = plain(host.querySelector('[data-testid="hold-warning"]')?.textContent);
      expect(warning).toContain('Quedan 1 minuto y 59 segundos para pagar');
      const live = host.querySelector('[data-testid="hold-announcement"]')!;
      expect(live.getAttribute('aria-live')).toBe('polite');
      const spoken = plain(live.textContent);
      expect(spoken).toBe('Quedan menos de 2 minutos para pagar tu stand.');

      await tick(fixture, 30_000);
      expect(plain(host.querySelector('[data-testid="hold-announcement"]')?.textContent)).toBe(
        spoken,
      );
      expect(plain(host.querySelector('[data-testid="hold-clock"]')?.textContent)).toBe('01:29');
    });

    it('turns into the expired message, announced as an alert, when the time runs out', async () => {
      const { host, fixture } = await resumeWith(3_000);
      expect(host.querySelector('[data-testid="hold-warning"]')).not.toBeNull();
      expect(host.querySelector('[role="alert"]')).toBeNull();

      await tick(fixture, 4_000);
      expect(plain(host.querySelector('[role="alert"]')?.textContent)).toContain('venció');
      expect(host.querySelector('[data-testid="hold-warning"]')).toBeNull();
      expect(host.querySelector('[data-testid="hold-clock"]')).toBeNull();
    });
  });

  it('resumes the payment of an existing reservation', async () => {
    const checkout = vi.fn(() => of(CHECKOUT));
    const { host } = await render({ reserva: 'r1' }, {}, { checkout });
    expect(checkout).toHaveBeenCalledWith('r1');
    expect(plain(host.textContent)).toContain('Pagá para confirmar tu stand');
  });

  it('refuses to resume a reservation that can no longer be paid', async () => {
    const cancelled = reservation({ status: 'CANCELLED' });
    const { host } = await render({ reserva: 'r1' }, {}, { reservation: () => of(cancelled) });
    expect(plain(host.querySelector('[role="alert"]')?.textContent)).toContain(
      'ya no se puede pagar',
    );
  });

  it('cancels the hold and goes back to the stands', async () => {
    const cancel = vi.fn(() => of(reservation({ status: 'CANCELLED' })));
    const { button, click, fixture } = await render({ reserva: 'r1', feria: 'f1' }, { cancel });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    await click(button('Cancelar reserva'));
    await fixture.whenStable();
    expect(cancel).toHaveBeenCalledWith('r1');
    expect(navigate).toHaveBeenCalledWith('/feriante/explorar/f1');
  });

  it('does not offer a stand that is not in the event', async () => {
    const { host } = await render({ stand: 'no-existe', feria: DEMO_EVENT_SLUG });
    expect(plain(host.querySelector('[role="alert"]')?.textContent)).toContain('No encontramos');
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  });
});

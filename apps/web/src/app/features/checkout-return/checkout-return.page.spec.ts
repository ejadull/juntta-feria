import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError, type Observable } from 'rxjs';
import { EXTERNAL_NAVIGATION } from '../../shared/external-navigation';
import { CHECKOUT_POLL, CheckoutReturnPage, type CheckoutOutcome } from './checkout-return.page';
import {
  ReservationPaymentRepository,
  type ReservationDto,
} from './data/reservation-payment.repository';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const MINUTE = 60_000;

const reservation = (patch: Partial<ReservationDto> = {}): ReservationDto => ({
  id: 'r1',
  status: 'PAYMENT_PENDING',
  holdExpiresAt: new Date(Date.now() + 10 * MINUTE).toISOString(),
  amount: { currency: 'ARS', valueCents: 4_500_000 },
  stand: { id: 's1', code: 'A-12', areaM2: 9 },
  eventId: 'e1',
  ...patch,
});

/** Answers each read with the next item; the last one repeats. */
class ScriptedRepository extends ReservationPaymentRepository {
  reads = 0;
  constructor(private readonly script: (ReservationDto | Error)[]) {
    super();
  }
  reservation(): Observable<ReservationDto> {
    const next = this.script[Math.min(this.reads++, this.script.length - 1)];
    return next instanceof Error ? throwError(() => next) : of(next);
  }
  checkoutUrl = vi.fn((): Observable<string> => of('https://mp.example/checkout'));
}

/** Renders the page and waits for the first `count` reads (they run on a timer). */
async function render(outcome: CheckoutOutcome, repo: ScriptedRepository, count: number) {
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: ReservationPaymentRepository, useValue: repo },
      { provide: EXTERNAL_NAVIGATION, useValue: navigate },
      { provide: CHECKOUT_POLL, useValue: { intervalMs: 1, attempts: 3 } },
    ],
  });
  const fixture = TestBed.createComponent(CheckoutReturnPage);
  fixture.componentRef.setInput('id', 'r1');
  fixture.componentRef.setInput('outcome', outcome);
  const reads = async (n: number) => {
    await vi.waitFor(() => expect(repo.reads).toBe(n));
    await fixture.whenStable();
  };
  await reads(count);
  const host = fixture.nativeElement as HTMLElement;
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find((b) => plain(b.textContent) === name);
  return { fixture, host, button, navigate, reads };
}

describe('CheckoutReturnPage (P19, PAY-04)', () => {
  it('waits for the webhook on an approved return and shows the confirmation from the API', async () => {
    const repo = new ScriptedRepository([
      reservation(),
      reservation(),
      reservation({ status: 'CONFIRMED', holdExpiresAt: null }),
    ]);
    const { host } = await render('approved', repo, 3);
    expect(plain(host.querySelector('h1')?.textContent)).toContain('stand está confirmado');
    expect(host.textContent).toContain('A-12');
    expect(host.textContent).toMatch(/\$\s?45\.000/);
    expect(host.querySelector('a[href="/feriante/reservas"]')).not.toBeNull();
  });

  it('does not trust an approved return the API has not confirmed', async () => {
    const repo = new ScriptedRepository([reservation()]);
    // Polls up to the configured attempts, then stops and offers to ask again.
    const { host, button, reads } = await render('approved', repo, 3);
    expect(plain(host.querySelector('h1')?.textContent)).not.toContain('confirmado');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('confirmación');
    button('Volver a consultar')!.click();
    await reads(6);
  });

  it('explains offline payments on a pending return, with the hold deadline', async () => {
    const { host, button } = await render('pending', new ScriptedRepository([reservation()]), 3);
    expect(plain(host.querySelector('h1')?.textContent)).toContain('pendiente');
    expect(host.textContent).toContain('Rapipago');
    expect(host.textContent).toMatch(/\d{2}:\d{2}/);
    expect(button('Volver a consultar')).toBeTruthy();
  });

  it('offers to retry a rejected payment while the hold is live', async () => {
    const repo = new ScriptedRepository([reservation()]);
    const { host, button, navigate, fixture } = await render('rejected', repo, 1);
    expect(plain(host.querySelector('h1')?.textContent)).toContain('rechazado');
    button('Reintentar el pago')!.click();
    await fixture.whenStable();
    expect(repo.reads).toBe(1); // no polling: a rejection is final for that attempt
    expect(repo.checkoutUrl).toHaveBeenCalledWith('r1');
    expect(navigate).toHaveBeenCalledWith('https://mp.example/checkout');
  });

  it('does not offer a retry once the hold is over', async () => {
    const past = new Date(Date.now() - MINUTE).toISOString();
    const { host, button } = await render(
      'rejected',
      new ScriptedRepository([reservation({ holdExpiresAt: past })]),
      1,
    );
    expect(button('Reintentar el pago')).toBeUndefined();
    expect(host.textContent).toContain('venció');
  });

  it('shows what the API says even when the return says otherwise', async () => {
    const { host } = await render(
      'approved',
      new ScriptedRepository([reservation({ status: 'EXPIRED', holdExpiresAt: null })]),
      1,
    );
    expect(plain(host.querySelector('h1')?.textContent)).toContain('venció');
    expect(host.querySelector('a[href="/feriante/explorar"]')).not.toBeNull();
  });

  it('reports a failed query and lets the exhibitor ask again', async () => {
    const repo = new ScriptedRepository([new Error('boom'), reservation({ status: 'CONFIRMED' })]);
    const { host, button, reads } = await render('pending', repo, 1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No pudimos');
    button('Volver a consultar')!.click();
    await reads(2);
    expect(plain(host.querySelector('h1')?.textContent)).toContain('confirmado');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

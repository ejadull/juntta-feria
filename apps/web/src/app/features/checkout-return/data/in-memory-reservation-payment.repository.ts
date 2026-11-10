import { defer, of, throwError, type Observable } from 'rxjs';
import type { CheckoutDto } from '../../../shared/mercado-pago-wallet';
import {
  ReservationPaymentRepository,
  type ReservationDto,
} from './reservation-payment.repository';

const MINUTE = 60_000;

interface DemoReservation {
  reservation: ReservationDto;
  /** Reads left until the "webhook" confirms it; null = never. */
  confirmIn: number | null;
}

const demo = (id: string, code: string, confirmIn: number | null): DemoReservation => ({
  reservation: {
    id,
    status: 'PAYMENT_PENDING',
    holdExpiresAt: new Date(Date.now() + 12 * MINUTE).toISOString(),
    amount: { currency: 'ARS', valueCents: 4_500_000 },
    stand: { id: `stand-${code}`, code, areaM2: 9 },
    eventId: 'patagonia-emprende-2026',
  },
  confirmIn,
});

/**
 * Demo adapter until the web has a session (CORE-02). Each id plays one return:
 * `demo-aprobada` gets confirmed on the second read, as when the webhook arrives a bit later;
 * `demo-pendiente` and `demo-rechazada` stay pending. A retry skips Mercado Pago and lands on
 * the approved return; it is a full page load, so the demo state starts over.
 */
export class InMemoryReservationPaymentRepository extends ReservationPaymentRepository {
  private readonly reservations = new Map<string, DemoReservation>([
    ['demo-aprobada', demo('demo-aprobada', 'A-12', 1)],
    ['demo-pendiente', demo('demo-pendiente', 'B-03', null)],
    ['demo-rechazada', demo('demo-rechazada', 'C-07', null)],
  ]);

  reservation(id: string): Observable<ReservationDto> {
    return defer(() => {
      const entry = this.reservations.get(id);
      if (!entry) return throwError(() => new Error('NOT_FOUND'));
      if (entry.confirmIn !== null && entry.confirmIn-- <= 0) {
        entry.reservation = { ...entry.reservation, status: 'CONFIRMED', holdExpiresAt: null };
        entry.confirmIn = null;
      }
      return of(entry.reservation);
    });
  }

  /** No public key in the demo: the Wallet Brick falls back to its link, which skips Mercado Pago. */
  checkout(id: string): Observable<CheckoutDto> {
    return defer(() => {
      const entry = this.reservations.get(id);
      if (!entry) return throwError(() => new Error('NOT_FOUND'));
      return of({
        checkoutUrl: `/feriante/reservas/${id}/pago/aprobado`,
        preferenceId: `demo-pref-${id}`,
        wallet: null,
      });
    });
  }
}

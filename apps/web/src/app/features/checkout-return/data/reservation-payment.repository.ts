import type { Observable } from 'rxjs';
import type { CheckoutDto } from '../../../shared/mercado-pago-wallet';

export type ReservationStatus =
  | 'HELD'
  | 'PAYMENT_PENDING'
  | 'CONFIRMED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

/** `GET /api/v1/reservations/{id}` (RES-01): the only source of truth for P19. */
export interface ReservationDto {
  readonly id: string;
  readonly status: ReservationStatus;
  readonly holdExpiresAt: string | null;
  readonly amount: { readonly currency: string; readonly valueCents: number };
  readonly stand: { readonly id: string; readonly code: string; readonly areaM2: number };
  readonly eventId: string;
}

export abstract class ReservationPaymentRepository {
  abstract reservation(id: string): Observable<ReservationDto>;
  /** `POST /reservations/{id}/checkout` (PAY-02): the open preference again, to retry a payment. */
  abstract checkout(id: string): Observable<CheckoutDto>;
}

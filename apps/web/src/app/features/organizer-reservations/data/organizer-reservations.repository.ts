import type { Observable } from 'rxjs';
import type {
  ReservationDto,
  ReservationStatus,
} from '../../checkout-return/data/reservation-payment.repository';

export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';

/** `GET /events` (EVT-01), only what the selector needs. */
export interface OrganizerEventDto {
  readonly id: string;
  readonly name: string;
  readonly status: EventStatus;
  readonly startsAt: string;
}

export type PaymentAttemptStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

/** `GET /reservations?eventId=` for staff (RES-01): the reservation plus who holds it and its last payment. */
export interface OrganizerReservationDto extends ReservationDto {
  readonly createdAt: string;
  readonly exhibitor: { readonly tradeName: string; readonly email: string };
  readonly payment: {
    readonly status: PaymentAttemptStatus;
    readonly paymentStatus: string | null;
    readonly updatedAt: string;
  } | null;
}

export type PaymentIncidentCode =
  'LATE_PAYMENT_CONFLICT' | 'AMOUNT_MISMATCH' | 'CHARGEBACK' | 'COLLECTOR_MISMATCH';

/** `GET /payment-incidents` (PAY-05): money that arrived but could not be applied. */
export interface PaymentIncidentDto {
  readonly id: string;
  readonly code: PaymentIncidentCode;
  readonly reservationId: string | null;
  readonly createdAt: string;
}

/** `POST /reservations/{id}/refunds` (PAY-06). */
export interface RefundResultDto {
  readonly reservationStatus: ReservationStatus;
}

/**
 * Port for P09/P10, the organizer's reservations and payments. Also the DI token.
 * Errors are the HTTP ones (`problemOf` reads the API `code`).
 */
export abstract class OrganizerReservationsRepository {
  abstract events(): Observable<readonly OrganizerEventDto[]>;
  abstract reservations(eventId: string): Observable<readonly OrganizerReservationDto[]>;
  /** `POST /reservations/{id}/cancel`: releases a live hold. */
  abstract cancel(reservationId: string): Observable<void>;
  /**
   * `POST /reservations/{id}/refunds`: refunds approved payments and cancels pending ones.
   * `idempotencyKey` belongs to one user action, so a retry can never refund twice;
   * no `amountCents` reverts everything.
   */
  abstract refund(
    reservationId: string,
    idempotencyKey: string,
    amountCents?: number,
  ): Observable<RefundResultDto>;
  abstract incidents(): Observable<readonly PaymentIncidentDto[]>;
}

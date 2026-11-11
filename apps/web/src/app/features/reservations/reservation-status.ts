import type {
  ReservationDto,
  ReservationStatus,
} from '../checkout-return/data/reservation-payment.repository';

export const STATUS_LABEL: Readonly<Record<ReservationStatus, string>> = {
  HELD: 'Retenida',
  PAYMENT_PENDING: 'Pago pendiente',
  CONFIRMED: 'Confirmada',
  EXPIRED: 'Vencida',
  CANCELLED: 'Cancelada',
  REFUND_PENDING: 'Devolución en curso',
  REFUNDED: 'Devuelta',
};

/** Terms the exhibitor accepts when holding a stand (sent as `termsVersion`). */
export const TERMS_VERSION = '2026-11';

const holdLapsed = (r: ReservationDto, now: number): boolean =>
  !!r.holdExpiresAt && Date.parse(r.holdExpiresAt) <= now;

/** A reservation that can still be paid: a hold, or a pending payment, that has not expired. */
export function isPayable(r: ReservationDto, now: number): boolean {
  if (r.status === 'PAYMENT_PENDING') return !holdLapsed(r, now);
  return r.status === 'HELD' && !!r.holdExpiresAt && !holdLapsed(r, now);
}

/** Hold over but the API still says PAYMENT_PENDING: reconciliation is checking with Mercado Pago. */
export function isVerifying(r: ReservationDto, now: number): boolean {
  return r.status === 'PAYMENT_PENDING' && holdLapsed(r, now);
}

/** Finished reservations (and lapsed holds): shown as history, after the active ones. */
export function isHistory(r: ReservationDto, now: number): boolean {
  if (r.status === 'HELD') return !isPayable(r, now);
  return r.status === 'EXPIRED' || r.status === 'CANCELLED' || r.status === 'REFUNDED';
}

/** The status the exhibitor sees: a lapsed hold reads "Vencida", an unconfirmed lapse "Verificando el pago". */
export function statusText(r: ReservationDto, now: number): string {
  if (isVerifying(r, now)) return 'Verificando el pago';
  if (r.status === 'HELD' && !isPayable(r, now)) return STATUS_LABEL.EXPIRED;
  return STATUS_LABEL[r.status];
}

/** "mm:ss" left until `deadline`, never negative. */
export function clock(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  return `${mm}:${String(total % 60).padStart(2, '0')}`;
}

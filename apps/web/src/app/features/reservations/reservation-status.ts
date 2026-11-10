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

/** A reservation that can still be paid: a pending payment, or a hold that has not expired. */
export function isPayable(r: ReservationDto, now: number): boolean {
  if (r.status === 'PAYMENT_PENDING') return true;
  return r.status === 'HELD' && !!r.holdExpiresAt && Date.parse(r.holdExpiresAt) > now;
}

/** "mm:ss" left until `deadline`, never negative. */
export function clock(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  return `${mm}:${String(total % 60).padStart(2, '0')}`;
}

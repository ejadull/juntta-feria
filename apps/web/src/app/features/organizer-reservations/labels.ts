import { problemOf } from '../../shared/auth/problem';
import type { ReservationStatus } from '../checkout-return/data/reservation-payment.repository';
import type {
  PaymentAttemptStatus,
  PaymentIncidentCode,
} from './data/organizer-reservations.repository';

/** Order of the filter chips; the visible label comes from `statusText`. */
export const STATUS_ORDER: readonly ReservationStatus[] = [
  'HELD',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'REFUND_PENDING',
  'REFUNDED',
  'EXPIRED',
  'CANCELLED',
];

/** A symbol beside the text, so the status never depends on color alone. */
export const STATUS_ICON: Readonly<Record<ReservationStatus, string>> = {
  HELD: '◔',
  PAYMENT_PENDING: '…',
  CONFIRMED: '✓',
  REFUND_PENDING: '↺',
  REFUNDED: '↩',
  EXPIRED: '○',
  CANCELLED: '✕',
};

export const PAYMENT_LABEL: Readonly<Record<PaymentAttemptStatus, string>> = {
  PENDING: 'Pendiente',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Vencido',
};

export const INCIDENT: Readonly<Record<PaymentIncidentCode, { title: string; detail: string }>> = {
  LATE_PAYMENT_CONFLICT: {
    title: 'Pago tardío',
    detail: 'El pago llegó cuando el stand ya no estaba reservado para este feriante.',
  },
  AMOUNT_MISMATCH: {
    title: 'Monto distinto',
    detail: 'Lo cobrado no coincide con el precio de la reserva.',
  },
  CHARGEBACK: {
    title: 'Contracargo',
    detail: 'El comprador desconoció el pago ante su banco.',
  },
  COLLECTOR_MISMATCH: {
    title: 'Cuenta de cobro distinta',
    detail: 'El pago entró en otra cuenta de Mercado Pago, no en la vinculada.',
  },
};

const BY_CODE: Readonly<Record<string, string>> = {
  RESERVATION_NOT_CANCELLABLE: 'Esta reserva ya no se puede cancelar. Actualizá la lista.',
  REFUND_IN_PROGRESS: 'Ya hay una devolución en curso para esta reserva. Esperá a que termine.',
  NOTHING_TO_REFUND: 'No queda ningún pago para devolver o cancelar en esta reserva.',
  REFUND_WINDOW_CLOSED:
    'Pasaron más de 180 días desde el pago: Mercado Pago ya no permite devolverlo.',
  PARTIAL_REFUND_AMBIGUOUS:
    'La devolución parcial solo se puede hacer cuando hay un único pago aprobado.',
  REFUND_AMOUNT_INVALID: 'El monto es mayor que lo que se pagó.',
};

const BY_STATUS: Readonly<Record<number, string>> = {
  401: 'Tu sesión venció. Ingresá de nuevo para seguir.',
  403: 'Tu rol no permite esta acción.',
  404: 'No encontramos la reserva. Actualizá la lista.',
  409: 'La reserva cambió mientras la mirabas. Actualizá la lista.',
  502: 'Mercado Pago no respondió. Podés reintentar: no se devuelve dos veces.',
  503: 'Los pagos no están disponibles por un momento. Probá de nuevo en unos minutos.',
};

export function actionError(error: unknown): string {
  const { status, code } = problemOf(error);
  return (
    (code && BY_CODE[code]) ||
    BY_STATUS[status] ||
    'No pudimos completar la acción. Probá de nuevo en unos minutos.'
  );
}

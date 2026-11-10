import { problemOf } from '../../shared/auth/problem';

export interface FriendlyError {
  readonly text: string;
  /** The problem is solved at the platform subscription screen. */
  readonly needsSubscription: boolean;
}

const BY_CODE: Readonly<Record<string, string>> = {
  STAND_UNAVAILABLE: 'Alguien se llevó este stand antes que vos. Elegí otro.',
  EVENT_SALES_CLOSED: 'La venta de stands de esta feria está cerrada.',
  PROFILE_INCOMPLETE: 'Completá tu perfil de feriante, incluido el CUIT, antes de reservar.',
  ACCOUNT_NOT_CONFIRMED: 'Confirmá tu cuenta desde el correo que te enviamos antes de reservar.',
  EXHIBITOR_NOT_AUTHORIZED: 'Solo podés reservar con tu propio perfil de feriante.',
  HOLD_LIMIT: 'Ya tenés el máximo de reservas retenidas. Pagá o cancelá alguna para seguir.',
  RESERVATION_NOT_PAYABLE: 'Esta reserva ya no se puede pagar: venció o se canceló.',
  RESERVATION_NOT_CANCELLABLE: 'Esta reserva ya no se puede cancelar.',
};

const BY_STATUS: Readonly<Record<number, string>> = {
  400: 'Los datos de la reserva no son válidos. Volvé a elegir el stand.',
  401: 'Tu sesión venció. Ingresá de nuevo para seguir.',
  403: 'Tu cuenta no puede reservar en esta feria.',
  404: 'No encontramos el stand o la reserva. Volvé a explorar los stands.',
  409: 'El stand ya no está disponible. Elegí otro.',
  429: 'Hiciste demasiados intentos. Esperá un momento y probá de nuevo.',
  503: 'El pago no está disponible por un momento. Probá de nuevo en unos minutos.',
};

const SUBSCRIPTION =
  'Para reservar necesitás una suscripción activa a la plataforma. Activala y volvé a elegir tu stand.';
const FALLBACK = 'No pudimos completar la operación. Probá de nuevo en unos minutos.';

export function friendly(error: unknown): FriendlyError {
  const { status, code } = problemOf(error);
  if (code === 'SUBSCRIPTION_REQUIRED') return { text: SUBSCRIPTION, needsSubscription: true };
  const text = (code && BY_CODE[code]) || BY_STATUS[status] || FALLBACK;
  return { text, needsSubscription: false };
}

/**
 * Event dates are typed and shown in Argentina time (UTC-3, no daylight saving), like the rest of
 * the organizer screens; the API wants ISO 8601 with an explicit offset.
 */
const OFFSET = '-03:00';
const OFFSET_MS = 3 * 60 * 60 * 1000;
const LOCAL_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export type DateField = 'startsAt' | 'endsAt' | 'salesOpenAt' | 'salesCloseAt';
export type DateTexts = Readonly<Record<DateField, string>>;
export type DateErrors = Partial<Record<DateField, string>>;

/** "2026-11-20T10:00" (datetime-local) to "2026-11-20T10:00:00-03:00"; null when not a date. */
export function localToIso(local: string): string | null {
  if (!LOCAL_SHAPE.test(local)) return null;
  const iso = `${local}:00${OFFSET}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Any ISO instant to the value a datetime-local input shows, in Argentina time. */
export function isoToLocal(iso: string): string {
  return new Date(Date.parse(iso) - OFFSET_MS).toISOString().slice(0, 16);
}

/** Same rules as the API: start before end, sales open before close, sales close by the end. */
export function dateErrors(texts: DateTexts): DateErrors {
  const errors: DateErrors = {};
  const at = {} as Record<DateField, number>;
  for (const field of Object.keys(texts) as DateField[]) {
    const iso = localToIso(texts[field]);
    if (iso === null) errors[field] = 'Ingresá una fecha y hora válidas.';
    else at[field] = Date.parse(iso);
  }
  if (Object.keys(errors).length > 0) return errors;
  if (at.startsAt >= at.endsAt) errors.endsAt = 'El fin tiene que ser posterior al inicio.';
  if (at.salesOpenAt >= at.salesCloseAt)
    errors.salesCloseAt = 'El cierre de ventas tiene que ser posterior a la apertura.';
  else if (at.salesCloseAt > at.endsAt)
    errors.salesCloseAt = 'Las ventas no pueden cerrar después de que termina el evento.';
  return errors;
}

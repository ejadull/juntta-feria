/** Money is stored as integer cents (spec §0); the UI shows whole pesos in es-AR. */

const FULL = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const ONE_DECIMAL = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const MONTH = new Intl.DateTimeFormat('es-AR', { month: 'short', timeZone: 'UTC' });
const NBSP = ' ';

/** From this amount on, compact mode shows millions ("$ 0,8 M"), like the dashboard mockup. */
const COMPACT_FROM_PESOS = 500_000;

export function formatArs(cents: number, { compact = false }: { compact?: boolean } = {}): string {
  const pesos = cents / 100;
  return compact && Math.abs(pesos) >= COMPACT_FROM_PESOS
    ? formatArsMillions(cents)
    : FULL.format(pesos);
}

/** Always in millions ("$ 0,1 M"): for series that must share one unit, like chart labels. */
export function formatArsMillions(cents: number): string {
  return `$${NBSP}${ONE_DECIMAL.format(cents / 100 / 1_000_000)}${NBSP}M`;
}

/** True when compact mode would show this amount in millions. */
export function isMillionsScale(cents: number): boolean {
  return Math.abs(cents / 100) >= COMPACT_FROM_PESOS;
}

/** 'YYYY-MM' → 'May' (short Spanish month, capitalized). */
export function formatMonth(yearMonth: string): string {
  const name = MONTH.format(new Date(`${yearMonth}-01T00:00:00Z`)).replace('.', '');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

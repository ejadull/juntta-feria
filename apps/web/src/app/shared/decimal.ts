/**
 * Parses a decimal typed by a person (es-AR): "1500", "1500,5", "1.500,50", "12.5".
 * Returns null for anything that is not a non-negative number with at most `maxDecimals` decimals.
 */
export function parseDecimal(text: string, maxDecimals = 2): number | null {
  const clean = text.replace(/[\s$]/g, '');
  const thousands = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(clean);
  const plain = thousands ? clean.replace(/\./g, '') : clean;
  if (!/^\d+([.,]\d+)?$/.test(plain)) return null;
  const [whole, fraction = ''] = plain.split(/[.,]/);
  if (fraction.length > maxDecimals) return null;
  return Number(fraction ? `${whole}.${fraction}` : whole);
}

/** Pesos typed by a person → integer cents (spec §0); null when not a valid amount. */
export function parsePesosToCents(text: string): number | null {
  const pesos = parseDecimal(text);
  return pesos === null ? null : Math.round(pesos * 100);
}

/** Cents → the text an input shows: "1500" or "1500,5" (no thousands separator, comma decimal). */
export function centsToInput(cents: number): string {
  const pesos = cents / 100;
  return Number.isInteger(pesos)
    ? String(pesos)
    : pesos.toFixed(2).replace(/0$/, '').replace('.', ',');
}

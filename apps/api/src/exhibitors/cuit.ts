const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/**
 * Argentine CUIT/CUIL: 11 digits, the last one an AFIP mod 11 check digit. Accepts dashes and
 * spaces ("20-12345678-6") and returns the bare digits, or null when the number is not valid.
 */
export function normalizeCuit(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '');
  if (!/^\d{11}$/.test(compact)) return null;
  const digits = compact.split('').map(Number); // ASCII digits only, checked above
  const sum = WEIGHTS.reduce((acc, weight, i) => acc + weight * digits[i], 0);
  const remainder = 11 - (sum % 11);
  // ponytail: AFIP never issues numbers whose check digit would be 10, so those are invalid.
  const check = remainder === 11 ? 0 : remainder;
  return check === digits[10] ? compact : null;
}

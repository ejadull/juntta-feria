/** Occupancy KPI (§1.4): assigned / sellable stands, as a whole percentage; null when nothing is sellable. */
export function occupancy(assigned: number, sellable: number): number | null {
  if (sellable <= 0) return null;
  // Multiply first: (23 / 40) * 100 is 57.4999… in floating point, 2300 / 40 is exactly 57.5.
  return Math.min(100, Math.max(0, Math.round((assigned * 100) / sellable)));
}

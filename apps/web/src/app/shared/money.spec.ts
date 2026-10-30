import { formatArs, formatArsMillions, formatMonth } from './money';

// Intl uses non-breaking spaces; compare with plain spaces.
const plain = (s: string) => s.replace(/\s/g, ' ');

describe('formatArs (cents → ARS)', () => {
  it.each([
    [244_200_000, '$ 2.442.000'],
    [17_400_000, '$ 174.000'],
    [0, '$ 0'],
    [99, '$ 1'], // pesos without cents, rounded
  ])('%i cents → %s', (cents, expected) => {
    expect(plain(formatArs(cents))).toBe(expected);
  });

  it.each([
    [244_200_000, '$ 2,4 M'], // spec scenario "GMV en pesos"
    [80_000_000, '$ 0,8 M'],
    [370_000_000, '$ 3,7 M'],
    [17_400_000, '$ 174.000'], // under a million: full amount
  ])('compact: %i cents → %s', (cents, expected) => {
    expect(plain(formatArs(cents, { compact: true }))).toBe(expected);
  });
});

describe('formatArsMillions', () => {
  it('always uses millions with one decimal', () => {
    expect(plain(formatArsMillions(12_000_000))).toBe('$ 0,1 M');
    expect(plain(formatArsMillions(244_200_000))).toBe('$ 2,4 M');
  });
});

describe('formatMonth', () => {
  it('shows a capitalized short month in Spanish', () => {
    expect(formatMonth('2026-05')).toBe('May');
    expect(formatMonth('2026-10')).toBe('Oct');
  });
});

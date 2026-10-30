import { occupancy } from './occupancy';

describe('occupancy (KPI §1.4: assigned / sellable)', () => {
  it('returns a whole percentage (spec: "Ocupación": 17 of 29 → 59 %)', () => {
    expect(occupancy(17, 29)).toBe(59);
  });

  it('rounds exact halves up despite floating point (23 / 40 = 57.5 → 58)', () => {
    expect(occupancy(23, 40)).toBe(58);
  });

  it('returns null without sellable stands (spec: "Ocupación sin stands")', () => {
    expect(occupancy(0, 0)).toBeNull();
  });

  it('caps at 100 and never goes below 0', () => {
    expect(occupancy(31, 29)).toBe(100);
    expect(occupancy(-1, 29)).toBe(0);
  });
});

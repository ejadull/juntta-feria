import { toPolygon } from '../../layout-editor/domain/geometry';
import type {
  MapFeature,
  PublicMapDto,
  PublicStandStatus,
} from '../data/public-catalog.repository';
import {
  areaOptions,
  countByStatus,
  matchesFilter,
  NO_FILTER,
  priceOptions,
  sectorOutlines,
  sectorsOf,
  standsOf,
} from './stand-filters';

const stand = (
  code: string,
  x: number,
  sector: string | null,
  status: PublicStandStatus,
  w = 3,
  priceCents = 10_000_000,
): MapFeature => ({
  type: 'Feature',
  geometry: toPolygon({ x, y: 2, w, h: 3 }),
  properties: {
    kind: 'STAND',
    standId: `id-${code}`,
    code,
    areaM2: w * 3,
    status,
    sector,
    price: { currency: 'ARS', valueCents: priceCents },
    exhibitor: null,
  },
});

const MAP: PublicMapDto = {
  slug: 'demo',
  layoutVersion: 1,
  units: 'm',
  bounds: { width: 40, height: 20 },
  features: [
    stand('A01', 1, 'Diseño', 'AVAILABLE'),
    stand('A02', 5, 'Diseño', 'OCCUPIED', 4, 18_000_000),
    stand('B01', 12, 'Regional', 'AVAILABLE', 3, 12_000_000),
    stand('B02', 16, 'Regional', 'BLOCKED'),
    stand('C01', 25, null, 'RESERVED'),
    {
      type: 'Feature',
      geometry: toPolygon({ x: 0, y: 8, w: 40, h: 3 }),
      properties: { kind: 'AISLE', label: 'Pasillo' },
    },
  ],
};

describe('stand filters (PUB-UI-03)', () => {
  it('extracts stands with their bounds, ignoring non-stand features', () => {
    const stands = standsOf(MAP);
    expect(stands.map((s) => s.code)).toEqual(['A01', 'A02', 'B01', 'B02', 'C01']);
    expect(stands[1]).toMatchObject({ x: 5, y: 2, w: 4, h: 3, areaM2: 12, priceCents: 18_000_000 });
  });

  it('counts stands per public status', () => {
    expect(countByStatus(standsOf(MAP))).toEqual({
      AVAILABLE: 2,
      RESERVED: 1,
      OCCUPIED: 1,
      BLOCKED: 1,
    });
  });

  it('matches by sector, minimum area and maximum price (null = no limit)', () => {
    const [a01, a02, b01] = standsOf(MAP);
    expect(matchesFilter(a01, NO_FILTER)).toBe(true);
    expect(matchesFilter(a01, { ...NO_FILTER, sector: 'Regional' })).toBe(false);
    expect(matchesFilter(b01, { ...NO_FILTER, sector: 'Regional' })).toBe(true);
    expect(matchesFilter(a01, { ...NO_FILTER, minAreaM2: 12 })).toBe(false);
    expect(matchesFilter(a02, { ...NO_FILTER, minAreaM2: 12 })).toBe(true);
    expect(matchesFilter(a02, { ...NO_FILTER, maxPriceCents: 12_000_000 })).toBe(false);
    expect(matchesFilter(b01, { ...NO_FILTER, maxPriceCents: 12_000_000 })).toBe(true);
  });

  it('derives filter options from the data (sorted, unique)', () => {
    const stands = standsOf(MAP);
    expect(sectorsOf(stands)).toEqual(['Diseño', 'Regional']);
    expect(areaOptions(stands)).toEqual([9, 12]);
    expect(priceOptions(stands)).toEqual([10_000_000, 12_000_000, 18_000_000]);
  });

  it('derives each sector outline as the padded envelope of its stands (ADR 0002)', () => {
    expect(sectorOutlines(standsOf(MAP), 0.5)).toEqual([
      { sector: 'Diseño', x: 0.5, y: 1.5, w: 9, h: 4 },
      { sector: 'Regional', x: 11.5, y: 1.5, w: 8, h: 4 },
    ]);
  });
});

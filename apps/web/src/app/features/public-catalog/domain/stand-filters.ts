import { fromPolygon, round2 } from '../../layout-editor/domain/geometry';
import type {
  PublicMapDto,
  PublicStandStatus,
  StandProperties,
} from '../data/public-catalog.repository';

/** A stand of the public map with its rectangle in meters, ready for filters and rendering. */
export interface StandView {
  readonly id: string;
  readonly code: string;
  readonly status: PublicStandStatus;
  readonly sector: string | null;
  readonly areaM2: number;
  readonly priceCents: number;
  readonly exhibitor: StandProperties['exhibitor'];
  readonly points: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Feriante filters (design D5). `null` means "no limit". */
export interface StandFilter {
  readonly sector: string | null;
  readonly minAreaM2: number | null;
  readonly maxPriceCents: number | null;
}

export const NO_FILTER: StandFilter = { sector: null, minAreaM2: null, maxPriceCents: null };

export interface SectorOutline {
  readonly sector: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function standsOf(map: PublicMapDto): StandView[] {
  return map.features.flatMap((f) => {
    const p = f.properties;
    if (p.kind !== 'STAND') return [];
    const ring = f.geometry.coordinates[0] ?? [];
    const rect = fromPolygon(f.geometry);
    const xs = ring.map(([x]) => x);
    const ys = ring.map(([, y]) => y);
    const [x, y] = rect ? [rect.x, rect.y] : [Math.min(...xs), Math.min(...ys)];
    return [
      {
        id: p.standId,
        code: p.code,
        status: p.status,
        sector: p.sector,
        areaM2: p.areaM2,
        priceCents: p.price.valueCents,
        exhibitor: p.exhibitor,
        points: ring.map(([px, py]) => `${px},${py}`).join(' '),
        x,
        y,
        w: rect ? rect.w : Math.max(...xs) - x,
        h: rect ? rect.h : Math.max(...ys) - y,
      },
    ];
  });
}

export function countByStatus(stands: readonly StandView[]): Record<PublicStandStatus, number> {
  const counts: Record<PublicStandStatus, number> = {
    AVAILABLE: 0,
    RESERVED: 0,
    OCCUPIED: 0,
    BLOCKED: 0,
  };
  for (const s of stands) counts[s.status]++;
  return counts;
}

export function matchesFilter(s: StandView, f: StandFilter): boolean {
  return (
    (f.sector === null || s.sector === f.sector) &&
    (f.minAreaM2 === null || s.areaM2 >= f.minAreaM2) &&
    (f.maxPriceCents === null || s.priceCents <= f.maxPriceCents)
  );
}

const uniqueSorted = (values: readonly number[]) => [...new Set(values)].sort((a, b) => a - b);

/** Sectors in map order (rows of the plan), not alphabetical. */
export function sectorsOf(stands: readonly StandView[]): string[] {
  const seen: string[] = [];
  for (const s of stands) if (s.sector && !seen.includes(s.sector)) seen.push(s.sector);
  return seen;
}

export const areaOptions = (stands: readonly StandView[]) =>
  uniqueSorted(stands.map((s) => s.areaM2));
export const priceOptions = (stands: readonly StandView[]) =>
  uniqueSorted(stands.map((s) => s.priceCents));

/** Envelope of each sector's stands plus `padding` meters (sectors are not drawn, ADR 0002). */
export function sectorOutlines(stands: readonly StandView[], padding = 0.6): SectorOutline[] {
  return sectorsOf(stands).map((sector) => {
    const own = stands.filter((s) => s.sector === sector);
    const x0 = Math.min(...own.map((s) => s.x)) - padding;
    const y0 = Math.min(...own.map((s) => s.y)) - padding;
    const x1 = Math.max(...own.map((s) => s.x + s.w)) + padding;
    const y1 = Math.max(...own.map((s) => s.y + s.h)) + padding;
    return { sector, x: round2(x0), y: round2(y0), w: round2(x1 - x0), h: round2(y1 - y0) };
  });
}

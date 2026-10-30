import type { Bounds, PolygonGeometry, Position, Rect } from './layout.types';

// Nudge so values like 1.005 (stored as 1.00499…) round half-up as humans expect.
const HALF_UP_NUDGE = 1e-9;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded =
    (Math.sign(value) * Math.round(Math.abs(value) * factor + HALF_UP_NUDGE)) / factor;
  return rounded === 0 ? 0 : rounded; // normalize -0
}

/** Meters rounded to centimeters. */
export function round2(value: number): number {
  return roundTo(value, 2);
}

export function snap(value: number, step: number): number {
  return round2(Math.round(value / step) * step);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Moves (never resizes) the rect so it stays inside the venue; oversized rects pin to the origin. */
export function clampToBounds(rect: Rect, bounds: Bounds): Rect {
  return {
    ...rect,
    x: round2(clamp(rect.x, 0, Math.max(0, bounds.widthM - rect.w))),
    y: round2(clamp(rect.y, 0, Math.max(0, bounds.heightM - rect.h))),
  };
}

export function toPolygon({ x, y, w, h }: Rect): PolygonGeometry {
  const x2 = round2(x + w);
  const y2 = round2(y + h);
  return {
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x2, y],
        [x2, y2],
        [x, y2],
        [x, y],
      ],
    ],
  };
}

const samePoint = (a: Position, b: Position): boolean => a[0] === b[0] && a[1] === b[1];

// Geometries are immutable and unchanged objects keep their geometry instance across edits,
// so caching by identity turns the per-frame parse of 500 stands into lookups (LUI-09).
const rectCache = new WeakMap<PolygonGeometry, Rect | null>();

/** Returns the rect for an axis-aligned rectangle polygon, or null for any other shape. */
export function fromPolygon(geometry: PolygonGeometry): Rect | null {
  if (rectCache.has(geometry)) return rectCache.get(geometry)!;
  const rect = parseRect(geometry);
  rectCache.set(geometry, rect);
  return rect;
}

function parseRect(geometry: PolygonGeometry): Rect | null {
  if (geometry.coordinates.length !== 1) return null;
  const ring = geometry.coordinates[0];
  if (ring.length !== 5 || !samePoint(ring[0], ring[4])) return null;

  const corners = ring.slice(0, 4);
  const xs = new Set(corners.map(([x]) => x));
  const ys = new Set(corners.map(([, y]) => y));
  if (xs.size !== 2 || ys.size !== 2) return null;

  // Each edge must be horizontal or vertical, never diagonal.
  const axisAligned = corners.every((p, i) => {
    const q = corners[(i + 1) % 4];
    return (p[0] === q[0]) !== (p[1] === q[1]);
  });
  if (!axisAligned) return null;

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: round2(Math.max(...xs) - minX), h: round2(Math.max(...ys) - minY) };
}

/** Interior overlap in m² (4 decimals, so the 0.0001 m² epsilon stays meaningful). Shared edges = 0. */
export function intersectionArea(a: Rect, b: Rect): number {
  const dx = round2(Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const dy = round2(Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return dx <= 0 || dy <= 0 ? 0 : roundTo(dx * dy, 4);
}

export function isInside(rect: Rect, bounds: Bounds): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    round2(rect.x + rect.w) <= bounds.widthM &&
    round2(rect.y + rect.h) <= bounds.heightM
  );
}

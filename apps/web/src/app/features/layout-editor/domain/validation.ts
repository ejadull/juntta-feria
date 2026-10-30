import { fromPolygon, intersectionArea } from './geometry';
import type { LayoutObjectDto, LayoutObjectKind, LayoutVersionDto, Rect } from './layout.types';

/**
 * Client-side mirror of INV-04 for instant feedback. NOT authoritative:
 * the backend (PostGIS, spec §3.4) has the final word on publish.
 */

export type ValidationCode =
  | 'OUT_OF_BOUNDS'
  | 'ZERO_AREA'
  | 'STAND_OVERLAP'
  | 'STAND_ON_RESERVED'
  | 'CODE_MISSING'
  | 'CODE_DUPLICATE'
  | 'NO_STANDS';

export interface ValidationIssue {
  readonly code: ValidationCode;
  readonly severity: 'error';
  readonly objectIds: readonly string[];
  readonly message: string;
}

/** Same epsilon as spec §3.4: shared edges (area 0) are valid. */
export const OVERLAP_EPSILON_M2 = 0.0001;

const RESERVED_KINDS: ReadonlySet<LayoutObjectKind> = new Set([
  'AISLE',
  'ENTRY',
  'EXIT',
  'EMERGENCY',
]);

export const KIND_LABEL: Readonly<Record<LayoutObjectKind, string>> = {
  STAND: 'Stand',
  AISLE: 'Pasillo',
  ENTRY: 'Entrada',
  EXIT: 'Salida',
  UTILITY: 'Servicio',
  OBSTACLE: 'Obstáculo',
  EMERGENCY: 'Salida de emergencia',
};

type LayoutInput = Pick<LayoutVersionDto, 'widthM' | 'heightM' | 'objects'>;

const label = (o: LayoutObjectDto): string => o.code?.trim() || KIND_LABEL[o.kind];
const error = (code: ValidationCode, objectIds: string[], message: string): ValidationIssue => ({
  code,
  severity: 'error',
  objectIds,
  message,
});

/** Shoelace area of the exterior ring. */
function ringArea(o: LayoutObjectDto): number {
  const ring = o.geometry.coordinates[0] ?? [];
  let twice = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    twice += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(twice) / 2;
}

function geometryIssues(
  objects: readonly LayoutObjectDto[],
  widthM: number,
  heightM: number,
): ValidationIssue[] {
  return objects.flatMap((o) => {
    if (ringArea(o) <= OVERLAP_EPSILON_M2) {
      return [error('ZERO_AREA', [o.id], `${label(o)} no tiene superficie.`)];
    }
    const outside = (o.geometry.coordinates[0] ?? []).some(
      ([x, y]) => x < 0 || y < 0 || x > widthM || y > heightM,
    );
    return outside
      ? [
          error(
            'OUT_OF_BOUNDS',
            [o.id],
            `${label(o)} se sale del predio (${widthM} × ${heightM} m).`,
          ),
        ]
      : [];
  });
}

interface Shape {
  readonly obj: LayoutObjectDto;
  readonly rect: Rect;
}

// ponytail: rect-only. Free polygons are skipped here and left to PostGIS.
function rectShapes(
  objects: readonly LayoutObjectDto[],
  keep: (o: LayoutObjectDto) => boolean,
): Shape[] {
  return objects.flatMap((obj) => {
    const rect = keep(obj) ? fromPolygon(obj.geometry) : null;
    return rect ? [{ obj, rect }] : [];
  });
}

/**
 * Sweep-line on x: sort once and stop scanning as soon as the next stand starts at or after the
 * current right edge, where no positive-area overlap is possible. Exact: every pair that could
 * overlap still goes through intersectionArea. Pairs are reported in the original object order.
 * Runs ~O(n log n + k) on real plans (the old full pair scan was 125k pairs per frame at 500 stands).
 */
function overlapIssues(stands: readonly Shape[]): ValidationIssue[] {
  const order = stands.map((_, i) => i).sort((p, q) => stands[p].rect.x - stands[q].rect.x);
  const pairs: [number, number][] = [];
  for (let s = 0; s < order.length; s++) {
    const a = stands[order[s]].rect;
    const right = a.x + a.w;
    for (let t = s + 1; t < order.length; t++) {
      const b = stands[order[t]].rect;
      if (b.x >= right) break;
      if (intersectionArea(a, b) > OVERLAP_EPSILON_M2) {
        pairs.push([Math.min(order[s], order[t]), Math.max(order[s], order[t])]);
      }
    }
  }
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return pairs.map(([i, j]) => {
    const [a, b] = [stands[i].obj, stands[j].obj];
    const area = intersectionArea(stands[i].rect, stands[j].rect);
    return error(
      'STAND_OVERLAP',
      [a.id, b.id],
      `${label(a)} y ${label(b)} se superponen ${area} m².`,
    );
  });
}

function reservedIssues(stands: readonly Shape[], reserved: readonly Shape[]): ValidationIssue[] {
  return stands.flatMap((s) =>
    reserved
      .filter((r) => intersectionArea(s.rect, r.rect) > OVERLAP_EPSILON_M2)
      .map((r) =>
        error(
          'STAND_ON_RESERVED',
          [s.obj.id, r.obj.id],
          `${label(s.obj)} invade ${KIND_LABEL[r.obj.kind].toLowerCase()}.`,
        ),
      ),
  );
}

function codeIssues(stands: readonly LayoutObjectDto[]): ValidationIssue[] {
  const missing = stands.filter((s) => !s.code?.trim()).map((s) => s.id);
  const byCode = new Map<string, string[]>();
  for (const s of stands) {
    const key = s.code?.trim().toUpperCase();
    if (key) byCode.set(key, [...(byCode.get(key) ?? []), s.id]);
  }

  const issues: ValidationIssue[] = [];
  if (missing.length)
    issues.push(error('CODE_MISSING', missing, `${missing.length} stand(s) sin código.`));
  for (const [code, ids] of byCode) {
    if (ids.length > 1)
      issues.push(
        error('CODE_DUPLICATE', ids, `El código ${code} se repite en ${ids.length} stands.`),
      );
  }
  return issues;
}

export function validateLayout({ widthM, heightM, objects }: LayoutInput): ValidationIssue[] {
  const standObjects = objects.filter((o) => o.kind === 'STAND');
  if (standObjects.length === 0) {
    return [
      ...geometryIssues(objects, widthM, heightM),
      error('NO_STANDS', [], 'El plano no tiene stands.'),
    ];
  }

  const stands = rectShapes(objects, (o) => o.kind === 'STAND');
  const reserved = rectShapes(objects, (o) => RESERVED_KINDS.has(o.kind));
  return [
    ...geometryIssues(objects, widthM, heightM),
    ...overlapIssues(stands),
    ...reservedIssues(stands, reserved),
    ...codeIssues(standObjects),
  ];
}

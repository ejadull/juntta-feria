import { clamp, clampToBounds, fromPolygon, round2, snap, toPolygon } from './geometry';
import type { Bounds, LayoutObjectDto, LayoutObjectKind, Rect } from './layout.types';

/** Pure edit commands: every function returns a new array and never mutates its input. */

export interface EditContext {
  readonly bounds: Bounds;
  /** Snap step in meters (0.25, 0.5 or 1). Also the minimum object size. */
  readonly step: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface ObjectPatch {
  readonly code?: string | null;
  readonly kind?: LayoutObjectKind;
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
}

type Objects = readonly LayoutObjectDto[];

const DEFAULT_SIZE: Readonly<Record<LayoutObjectKind, { w: number; h: number }>> = {
  STAND: { w: 3, h: 3 },
  AISLE: { w: 2, h: 10 },
  ENTRY: { w: 4, h: 1 },
  EXIT: { w: 2, h: 1 },
  UTILITY: { w: 2, h: 2 },
  OBSTACLE: { w: 1, h: 1 },
  EMERGENCY: { w: 2, h: 1 },
};
const DEFAULT_STAND_PREFIX = 'S';

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function nextCode(objects: Objects, prefix: string): string {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`);
  const max = objects.reduce((acc, o) => {
    const match = o.code?.match(pattern);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

/** Applies `fn` to the rect of `id`. Unknown ids and non-rectangular objects return `objects` untouched. */
function updateRect(objects: Objects, id: string, fn: (rect: Rect) => Rect): Objects {
  const target = objects.find((o) => o.id === id);
  const rect = target && fromPolygon(target.geometry);
  if (!rect) return objects;
  const next = fn(rect);
  // Same rect (e.g. arrow key against the venue edge) keeps identity, so the store records no history.
  if (next.x === rect.x && next.y === rect.y && next.w === rect.w && next.h === rect.h)
    return objects;
  const geometry = toPolygon(next);
  return objects.map((o) => (o.id === id ? { ...o, geometry } : o));
}

export function addObject(
  objects: Objects,
  kind: LayoutObjectKind,
  at: Point,
  ctx: EditContext,
  id: string,
): Objects {
  const size = DEFAULT_SIZE[kind];
  const rect = clampToBounds(
    { x: snap(at.x, ctx.step), y: snap(at.y, ctx.step), ...size },
    ctx.bounds,
  );
  const code = kind === 'STAND' ? nextCode(objects, DEFAULT_STAND_PREFIX) : null;
  return [...objects, { id, kind, code, geometry: toPolygon(rect), metadata: {} }];
}

export function moveObject(objects: Objects, id: string, to: Point, ctx: EditContext): Objects {
  return updateRect(objects, id, (r) =>
    clampToBounds({ ...r, x: snap(to.x, ctx.step), y: snap(to.y, ctx.step) }, ctx.bounds),
  );
}

/** Drags one edge or corner to `to`; the opposite side stays fixed. */
export function resizeObject(
  objects: Objects,
  id: string,
  handle: ResizeHandle,
  to: Point,
  ctx: EditContext,
): Objects {
  const { step, bounds } = ctx;
  return updateRect(objects, id, (r) => {
    let x1 = r.x;
    let y1 = r.y;
    let x2 = round2(r.x + r.w);
    let y2 = round2(r.y + r.h);
    if (handle.includes('w')) x1 = clamp(snap(to.x, step), 0, round2(x2 - step));
    if (handle.includes('e')) x2 = clamp(snap(to.x, step), round2(x1 + step), bounds.widthM);
    if (handle.includes('n')) y1 = clamp(snap(to.y, step), 0, round2(y2 - step));
    if (handle.includes('s')) y2 = clamp(snap(to.y, step), round2(y1 + step), bounds.heightM);
    return { x: x1, y: y1, w: round2(x2 - x1), h: round2(y2 - y1) };
  });
}

/** Rotates 90° around the center (swap w/h), then re-clamps. Not snapped, to preserve the center. */
export function rotate90(objects: Objects, id: string, ctx: EditContext): Objects {
  return updateRect(objects, id, (r) => {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    return clampToBounds(
      { x: round2(cx - r.h / 2), y: round2(cy - r.w / 2), w: r.h, h: r.w },
      ctx.bounds,
    );
  });
}

/** Copies the object to the right of the source (sharing an edge) with a fresh code. */
export function duplicateObject(
  objects: Objects,
  id: string,
  ctx: EditContext,
  newId: string,
): Objects {
  const source = objects.find((o) => o.id === id);
  const rect = source && fromPolygon(source.geometry);
  if (!source || !rect) return objects;

  const copyRect = clampToBounds({ ...rect, x: round2(rect.x + rect.w) }, ctx.bounds);
  const prefix = source.code?.replace(/\d+$/, '') || DEFAULT_STAND_PREFIX;
  const code = source.kind === 'STAND' ? nextCode(objects, prefix) : null;
  return [...objects, { ...source, id: newId, code, geometry: toPolygon(copyRect) }];
}

export function removeObject(objects: Objects, id: string): Objects {
  return objects.filter((o) => o.id !== id);
}

const GEOMETRY_KEYS = ['x', 'y', 'w', 'h'] as const;

/** Edits typed properties. Sizes are floored to one snap step; position is clamped, not snapped. */
export function updateProps(
  objects: Objects,
  id: string,
  patch: ObjectPatch,
  ctx: EditContext,
): Objects {
  const target = objects.find((o) => o.id === id);
  if (!target) return objects;

  const rect = fromPolygon(target.geometry);
  const hasGeometry = GEOMETRY_KEYS.some((k) => patch[k] !== undefined);
  const hasOther = patch.code !== undefined || patch.kind !== undefined;
  if (hasGeometry && !rect && !hasOther) return objects;

  const kind = patch.kind ?? target.kind;
  let code = patch.code === undefined ? target.code : patch.code?.trim() || null;
  // Only auto-code on becoming a stand; a code cleared on purpose is left for CODE_MISSING to flag.
  const becameStand = kind === 'STAND' && target.kind !== 'STAND';
  if (becameStand && code === null) code = nextCode(objects, DEFAULT_STAND_PREFIX);

  let geometry = target.geometry;
  if (hasGeometry && rect) {
    const w = Math.max(round2(patch.w ?? rect.w), ctx.step);
    const h = Math.max(round2(patch.h ?? rect.h), ctx.step);
    const next = { x: round2(patch.x ?? rect.x), y: round2(patch.y ?? rect.y), w, h };
    geometry = toPolygon(clampToBounds(next, ctx.bounds));
  }

  return objects.map((o) => (o.id === id ? { ...o, kind, code, geometry } : o));
}

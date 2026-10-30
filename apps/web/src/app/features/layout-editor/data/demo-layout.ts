import { toPolygon } from '../domain/geometry';
import type {
  LayoutObjectDto,
  LayoutObjectKind,
  LayoutVersionDto,
  Rect,
} from '../domain/layout.types';

/** Synthetic 100×60 m venue for local development: central aisle, entrance and 4 rows of 10 stands. */

const STAND = { w: 3, h: 3 };
const STANDS_PER_ROW = 10;
const ROW_START_X = 5;
const STAND_PITCH_X = 4; // 3 m stand + 1 m gap
const ROWS = [
  { prefix: 'A', y: 10 },
  { prefix: 'B', y: 16 },
  { prefix: 'C', y: 40 },
  { prefix: 'D', y: 46 },
] as const;

const object = (
  id: string,
  kind: LayoutObjectKind,
  code: string | null,
  rect: Rect,
): LayoutObjectDto => ({
  id,
  kind,
  code,
  geometry: toPolygon(rect),
  metadata: {},
});

const stands = ROWS.flatMap(({ prefix, y }) =>
  Array.from({ length: STANDS_PER_ROW }, (_, i) => {
    const code = `${prefix}${String(i + 1).padStart(2, '0')}`;
    return object(`demo-${code}`, 'STAND', code, {
      x: ROW_START_X + i * STAND_PITCH_X,
      y,
      ...STAND,
    });
  }),
);

export const DEMO_LAYOUT: LayoutVersionDto = {
  id: 'demo-v1',
  templateId: 'demo-template',
  version: 1,
  status: 'DRAFT',
  widthM: 100,
  heightM: 60,
  objects: [
    object('demo-aisle', 'AISLE', null, { x: 0, y: 28, w: 100, h: 4 }),
    object('demo-entry', 'ENTRY', null, { x: 48, y: 59, w: 4, h: 1 }),
    object('demo-exit', 'EMERGENCY', null, { x: 0, y: 0, w: 2, h: 1 }),
    ...stands,
  ],
};

/** Stress seed for LUI-09: 20 rows (A–T) × 25 stands of 3×3 m on a 105×106 m venue, all valid. */
const STRESS_ROWS = 20;
const STRESS_COLS = 25;
const STRESS_PITCH = { x: 4, y: 5 }; // 1 m gap between columns, 2 m aisle between rows
const STRESS_ORIGIN = { x: 3, y: 3 };

const stressStands = Array.from({ length: STRESS_ROWS * STRESS_COLS }, (_, n) => {
  const row = Math.floor(n / STRESS_COLS);
  const col = n % STRESS_COLS;
  const code = `${String.fromCharCode(65 + row)}${String(col + 1).padStart(2, '0')}`;
  return object(`stress-${code}`, 'STAND', code, {
    x: STRESS_ORIGIN.x + col * STRESS_PITCH.x,
    y: STRESS_ORIGIN.y + row * STRESS_PITCH.y,
    ...STAND,
  });
});

export const STRESS_LAYOUT: LayoutVersionDto = {
  id: 'stress-500',
  templateId: 'stress-template',
  version: 1,
  status: 'DRAFT',
  widthM: 105,
  heightM: 106,
  objects: [object('stress-entry', 'ENTRY', null, { x: 50, y: 105, w: 5, h: 1 }), ...stressStands],
};

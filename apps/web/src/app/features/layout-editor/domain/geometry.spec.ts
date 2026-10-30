import {
  clamp,
  clampToBounds,
  fromPolygon,
  intersectionArea,
  isInside,
  round2,
  snap,
  toPolygon,
} from './geometry';
import type { PolygonGeometry } from './layout.types';

const bounds = { widthM: 100, heightM: 60 };

describe('round2', () => {
  it('rounds to centimeters', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(-2.344)).toBe(-2.34);
  });
});

describe('snap', () => {
  it('snaps to the nearest step (spec: "Snap al mover")', () => {
    expect(snap(10.37, 0.5)).toBe(10.5);
    expect(snap(10.2, 0.5)).toBe(10);
  });

  it('supports 0.25 m and 1 m steps without float noise', () => {
    expect(snap(3.13, 0.25)).toBe(3.25);
    expect(snap(0.3, 0.1)).toBe(0.3);
    expect(snap(7.49, 1)).toBe(7);
  });
});

describe('clamp', () => {
  it('limits a value to [min, max]', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe('clampToBounds', () => {
  it('keeps the rect inside the venue (spec: "Clamp en el borde")', () => {
    expect(clampToBounds({ x: 99, y: 10, w: 3, h: 3 }, bounds)).toEqual({
      x: 97,
      y: 10,
      w: 3,
      h: 3,
    });
    expect(clampToBounds({ x: -4, y: -1, w: 3, h: 3 }, bounds)).toEqual({ x: 0, y: 0, w: 3, h: 3 });
  });

  it('pins to origin when the rect is larger than the venue', () => {
    expect(clampToBounds({ x: 5, y: 5, w: 120, h: 3 }, bounds)).toEqual({
      x: 0,
      y: 5,
      w: 120,
      h: 3,
    });
  });

  it('does not mutate its input', () => {
    const rect = Object.freeze({ x: 99, y: 0, w: 3, h: 3 });
    clampToBounds(rect, bounds);
    expect(rect.x).toBe(99);
  });
});

describe('toPolygon', () => {
  it('serializes a closed counter-clockwise ring (spec: "Serialización a Polygon")', () => {
    expect(toPolygon({ x: 10, y: 10, w: 3, h: 3 })).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [10, 10],
          [13, 10],
          [13, 13],
          [10, 13],
          [10, 10],
        ],
      ],
    });
  });
});

describe('fromPolygon', () => {
  it('round-trips an axis-aligned rectangle', () => {
    const rect = { x: 10, y: 12, w: 3, h: 4 };
    expect(fromPolygon(toPolygon(rect))).toEqual(rect);
  });

  it('accepts any starting vertex and winding', () => {
    const clockwiseFromTopRight: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [13, 10],
          [10, 10],
          [10, 14],
          [13, 14],
          [13, 10],
        ],
      ],
    };
    expect(fromPolygon(clockwiseFromTopRight)).toEqual({ x: 10, y: 10, w: 3, h: 4 });
  });

  it('returns null for a free polygon (spec: "Polígono libre")', () => {
    const pentagon: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [5, 3],
          [2, 5],
          [-1, 3],
          [0, 0],
        ],
      ],
    };
    expect(fromPolygon(pentagon)).toBeNull();
  });

  it('returns null for a rotated (non axis-aligned) square', () => {
    const diamond: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [2, 0],
          [4, 2],
          [2, 4],
          [0, 2],
          [2, 0],
        ],
      ],
    };
    expect(fromPolygon(diamond)).toBeNull();
  });

  it('returns null for open rings, holes and zero area', () => {
    const open: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
      ],
    };
    const withHole: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
        [
          [1, 1],
          [2, 1],
          [2, 2],
          [1, 2],
          [1, 1],
        ],
      ],
    };
    const flat: PolygonGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [3, 0],
          [3, 0],
          [0, 0],
          [0, 0],
        ],
      ],
    };
    expect(fromPolygon(open)).toBeNull();
    expect(fromPolygon(withHole)).toBeNull();
    expect(fromPolygon(flat)).toBeNull();
  });
});

describe('intersectionArea', () => {
  it('is 0 for stands sharing an edge (AC-02)', () => {
    expect(intersectionArea({ x: 0, y: 0, w: 3, h: 3 }, { x: 3, y: 0, w: 3, h: 3 })).toBe(0);
  });

  it('is 0 for disjoint rects', () => {
    expect(intersectionArea({ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 5, w: 1, h: 1 })).toBe(0);
  });

  it('measures interior overlap (AC-02: 0.5 m²)', () => {
    expect(intersectionArea({ x: 0, y: 0, w: 3, h: 1 }, { x: 2.5, y: 0, w: 3, h: 1 })).toBe(0.5);
  });

  it('handles containment', () => {
    expect(intersectionArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 2, w: 3, h: 4 })).toBe(12);
  });
});

describe('isInside', () => {
  it('accepts rects touching the venue edges', () => {
    expect(isInside({ x: 0, y: 0, w: 100, h: 60 }, bounds)).toBe(true);
    expect(isInside({ x: 97, y: 57, w: 3, h: 3 }, bounds)).toBe(true);
  });

  it('rejects rects crossing any edge', () => {
    expect(isInside({ x: 98, y: 0, w: 3, h: 3 }, bounds)).toBe(false);
    expect(isInside({ x: -0.5, y: 0, w: 3, h: 3 }, bounds)).toBe(false);
    expect(isInside({ x: 0, y: 58, w: 3, h: 3 }, bounds)).toBe(false);
  });
});

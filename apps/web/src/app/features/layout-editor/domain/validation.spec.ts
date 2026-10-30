import { toPolygon } from './geometry';
import type { LayoutObjectDto, LayoutObjectKind, Rect } from './layout.types';
import { validateLayout, type ValidationCode, type ValidationIssue } from './validation';

const W = 100;
const H = 60;

function obj(
  id: string,
  rect: Rect,
  kind: LayoutObjectKind = 'STAND',
  code: string | null = id,
): LayoutObjectDto {
  return { id, kind, code, geometry: toPolygon(rect), metadata: {} };
}

function validate(...objects: LayoutObjectDto[]): ValidationIssue[] {
  return validateLayout({ widthM: W, heightM: H, objects });
}

const codes = (issues: ValidationIssue[]): ValidationCode[] => issues.map((i) => i.code);
const issue = (issues: ValidationIssue[], code: ValidationCode): ValidationIssue | undefined =>
  issues.find((i) => i.code === code);

describe('validateLayout', () => {
  it('accepts a valid layout', () => {
    expect(
      validate(obj('A01', { x: 0, y: 0, w: 3, h: 3 }), obj('A02', { x: 5, y: 0, w: 3, h: 3 })),
    ).toEqual([]);
  });

  describe('STAND_OVERLAP (AC-02)', () => {
    it('accepts stands sharing an edge', () => {
      expect(
        validate(obj('A', { x: 0, y: 0, w: 3, h: 3 }), obj('B', { x: 3, y: 0, w: 3, h: 3 })),
      ).toEqual([]);
    });

    it('accepts stands touching only at a corner', () => {
      expect(
        validate(obj('A', { x: 0, y: 0, w: 3, h: 3 }), obj('B', { x: 3, y: 3, w: 3, h: 3 })),
      ).toEqual([]);
    });

    it('rejects a 0.5 m² interior overlap and references both stands', () => {
      const issues = validate(
        obj('A', { x: 0, y: 0, w: 3, h: 1 }),
        obj('B', { x: 2.5, y: 0, w: 3, h: 1 }),
      );
      expect(codes(issues)).toEqual(['STAND_OVERLAP']);
      expect(issue(issues, 'STAND_OVERLAP')?.objectIds).toEqual(['A', 'B']);
    });

    it('matches spec §3.4 strictly: exactly 0.0001 m² (1 cm²) passes, like PostGIS "> 0.0001"', () => {
      expect(
        validate(obj('A', { x: 0, y: 0, w: 3, h: 3 }), obj('B', { x: 2.99, y: 2.99, w: 3, h: 3 })),
      ).toEqual([]);
    });

    it('rejects the smallest overlap above epsilon (2 cm²)', () => {
      const issues = validate(
        obj('A', { x: 0, y: 0, w: 3, h: 3 }),
        obj('B', { x: 2.98, y: 2.99, w: 3, h: 3 }),
      );
      expect(codes(issues)).toEqual(['STAND_OVERLAP']);
    });

    it('reports one issue per overlapping pair', () => {
      const issues = validate(
        obj('A', { x: 0, y: 0, w: 4, h: 4 }),
        obj('B', { x: 1, y: 1, w: 4, h: 4 }),
        obj('C', { x: 2, y: 2, w: 4, h: 4 }),
      );
      expect(issues.filter((i) => i.code === 'STAND_OVERLAP').map((i) => i.objectIds)).toEqual([
        ['A', 'B'],
        ['A', 'C'],
        ['B', 'C'],
      ]);
    });

    it('ignores overlaps between non-stand objects', () => {
      const issues = validate(
        obj('A01', { x: 20, y: 20, w: 3, h: 3 }),
        obj('u1', { x: 0, y: 0, w: 3, h: 3 }, 'UTILITY', null),
        obj('u2', { x: 1, y: 1, w: 3, h: 3 }, 'OBSTACLE', null),
      );
      expect(issues).toEqual([]);
    });
  });

  describe('STAND_ON_RESERVED', () => {
    it.each<LayoutObjectKind>(['AISLE', 'ENTRY', 'EXIT', 'EMERGENCY'])(
      'rejects a stand on %s',
      (kind) => {
        const issues = validate(
          obj('A01', { x: 0, y: 0, w: 3, h: 3 }),
          obj('r', { x: 2, y: 0, w: 2, h: 10 }, kind, null),
        );
        expect(codes(issues)).toEqual(['STAND_ON_RESERVED']);
        expect(issue(issues, 'STAND_ON_RESERVED')?.objectIds).toEqual(['A01', 'r']);
      },
    );

    it('accepts a stand bordering an aisle', () => {
      expect(
        validate(
          obj('A01', { x: 0, y: 0, w: 3, h: 3 }),
          obj('r', { x: 3, y: 0, w: 2, h: 10 }, 'AISLE', null),
        ),
      ).toEqual([]);
    });

    it('accepts a stand on a utility area (not reserved for circulation)', () => {
      expect(
        validate(
          obj('A01', { x: 0, y: 0, w: 3, h: 3 }),
          obj('u', { x: 1, y: 1, w: 1, h: 1 }, 'UTILITY', null),
        ),
      ).toEqual([]);
    });
  });

  describe('OUT_OF_BOUNDS', () => {
    it('rejects an object crossing the venue edge', () => {
      const issues = validate(obj('A01', { x: 98, y: 0, w: 3, h: 3 }));
      expect(codes(issues)).toEqual(['OUT_OF_BOUNDS']);
    });

    it('accepts objects flush with the venue edges', () => {
      expect(validate(obj('A01', { x: 97, y: 57, w: 3, h: 3 }))).toEqual([]);
    });

    it('checks every vertex of free polygons', () => {
      const pentagon: LayoutObjectDto = {
        id: 'p',
        kind: 'OBSTACLE',
        code: null,
        geometry: {
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
        },
        metadata: {},
      };
      expect(codes(validate(obj('A01', { x: 20, y: 20, w: 3, h: 3 }), pentagon))).toEqual([
        'OUT_OF_BOUNDS',
      ]);
    });
  });

  describe('ZERO_AREA', () => {
    it('rejects degenerate geometry', () => {
      const flat: LayoutObjectDto = {
        id: 'flat',
        kind: 'OBSTACLE',
        code: null,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [1, 1],
              [5, 1],
              [5, 1],
              [1, 1],
              [1, 1],
            ],
          ],
        },
        metadata: {},
      };
      expect(codes(validate(obj('A01', { x: 20, y: 20, w: 3, h: 3 }), flat))).toEqual([
        'ZERO_AREA',
      ]);
    });
  });

  describe('codes', () => {
    it('CODE_MISSING for stands without a code', () => {
      const issues = validate(
        obj('a', { x: 0, y: 0, w: 3, h: 3 }, 'STAND', null),
        obj('b', { x: 5, y: 0, w: 3, h: 3 }, 'STAND', '  '),
      );
      expect(issue(issues, 'CODE_MISSING')?.objectIds).toEqual(['a', 'b']);
    });

    it('CODE_DUPLICATE groups every stand sharing a code, case-insensitive', () => {
      const issues = validate(
        obj('a', { x: 0, y: 0, w: 3, h: 3 }, 'STAND', 'A01'),
        obj('b', { x: 5, y: 0, w: 3, h: 3 }, 'STAND', 'a01'),
        obj('c', { x: 10, y: 0, w: 3, h: 3 }, 'STAND', 'A01'),
        obj('d', { x: 15, y: 0, w: 3, h: 3 }, 'STAND', 'A02'),
      );
      expect(codes(issues)).toEqual(['CODE_DUPLICATE']);
      expect(issue(issues, 'CODE_DUPLICATE')?.objectIds).toEqual(['a', 'b', 'c']);
    });
  });

  it('NO_STANDS for an empty or stand-less layout', () => {
    expect(codes(validate())).toEqual(['NO_STANDS']);
    expect(codes(validate(obj('aisle', { x: 0, y: 0, w: 2, h: 10 }, 'AISLE', null)))).toEqual([
      'NO_STANDS',
    ]);
  });

  it('every issue carries a non-empty Spanish message', () => {
    const issues = validate(
      obj('A', { x: 0, y: 0, w: 3, h: 1 }, 'STAND', null),
      obj('B', { x: 98.5, y: 0, w: 3, h: 1 }, 'STAND', null),
    );
    expect(issues.length).toBeGreaterThan(0);
    issues.forEach((i) => {
      expect(i.severity).toBe('error');
      expect(i.message.trim().length).toBeGreaterThan(0);
    });
  });

  it('validates 500 stands in under 50 ms', () => {
    const stands = Array.from({ length: 500 }, (_, i) =>
      obj(`s${i}`, { x: (i % 25) * 4, y: Math.floor(i / 25) * 3, w: 3, h: 2.5 }, 'STAND', `S${i}`),
    );
    validateLayout({ widthM: W, heightM: H, objects: stands }); // warm up
    const start = performance.now();
    const issues = validateLayout({ widthM: W, heightM: H, objects: stands });
    expect(performance.now() - start).toBeLessThan(50);
    expect(issues).toEqual([]);
  });

  it('finds exactly the overlapping pairs a brute-force scan finds, in the same order (LUI-09 guard)', () => {
    // Deterministic PRNG so the layout is the same on every run.
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const at = (max: number) => Math.round(rand() * max * 4) / 4; // 0.25 m grid → shared edges happen
    const stands = Array.from({ length: 300 }, (_, i) =>
      obj(`s${i}`, { x: at(90), y: at(50), w: 1 + at(6), h: 1 + at(6) }, 'STAND', `S${i}`),
    );

    const expected: string[] = [];
    for (let i = 0; i < stands.length; i++)
      for (let j = i + 1; j < stands.length; j++) {
        const issues = validate(stands[i], stands[j]);
        if (issue(issues, 'STAND_OVERLAP')) expected.push(`${stands[i].id}+${stands[j].id}`);
      }

    const actual = validateLayout({ widthM: W, heightM: H, objects: stands })
      .filter((i) => i.code === 'STAND_OVERLAP')
      .map((i) => i.objectIds.join('+'));
    expect(expected.length).toBeGreaterThan(50); // the guard is meaningful
    expect(actual).toEqual(expected);
  });
});

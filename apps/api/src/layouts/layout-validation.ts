import { sql } from 'drizzle-orm';
import type { Transaction } from '../db/database.service.js';

/**
 * Server-side INV-04 (§3.4), the authority over the editor's client-side mirror (LUI-05 D4).
 * Same codes as the editor plus INVALID_GEOMETRY (self-intersecting or degenerate polygons,
 * which the rectangle-only editor cannot draw but an API client can send).
 */
export type LayoutIssueCode =
  | 'INVALID_GEOMETRY'
  | 'OUT_OF_BOUNDS'
  | 'STAND_OVERLAP'
  | 'STAND_ON_RESERVED'
  | 'CODE_MISSING'
  | 'CODE_DUPLICATE'
  | 'NO_STANDS';

export interface LayoutIssue {
  readonly code: LayoutIssueCode;
  readonly objectIds: readonly string[];
  readonly message: string;
}

/** Same epsilon as §3.4 and the editor: sharing an edge (area 0) is valid. */
export const OVERLAP_EPSILON_M2 = 0.0001;

const MESSAGES: Readonly<Record<LayoutIssueCode, string>> = {
  INVALID_GEOMETRY:
    'The polygon is not valid (self-intersecting or degenerate).',
  OUT_OF_BOUNDS: 'The object is outside the layout bounds.',
  STAND_OVERLAP: 'Two stands overlap.',
  STAND_ON_RESERVED:
    'A stand overlaps an aisle, entry, exit or emergency area.',
  CODE_MISSING: 'The stand has no code.',
  CODE_DUPLICATE: 'Several stands share the same code.',
  NO_STANDS: 'The layout has no stands.',
};

/**
 * Every rule in one round trip. Spatial rules only look at valid polygons: PostGIS overlay
 * functions throw on invalid input, and those already report INVALID_GEOMETRY.
 */
export async function validateLayoutVersion(
  tx: Transaction,
  versionId: string,
  widthM: number,
  heightM: number,
): Promise<LayoutIssue[]> {
  const { rows } = await tx.execute<{
    code: LayoutIssueCode;
    ids: string[];
  }>(sql`
    WITH o AS (
      SELECT id, kind, btrim(code) AS code, geometry, ST_IsValid(geometry) AS valid
      FROM layout_objects WHERE layout_version_id = ${versionId}
    ),
    stands AS (SELECT * FROM o WHERE kind = 'STAND')
    SELECT code, ids FROM (
      SELECT 'INVALID_GEOMETRY' AS code, ARRAY[id::text] AS ids FROM o WHERE NOT valid
      UNION ALL
      SELECT 'OUT_OF_BOUNDS', ARRAY[id::text] FROM o
      WHERE valid AND NOT ST_CoveredBy(geometry, ST_MakeEnvelope(0, 0, ${widthM}, ${heightM}, 0))
      UNION ALL
      SELECT 'STAND_OVERLAP', ARRAY[a.id::text, b.id::text]
      FROM stands a JOIN stands b ON a.id < b.id
      WHERE a.valid AND b.valid AND ST_Intersects(a.geometry, b.geometry)
        AND ST_Area(ST_Intersection(a.geometry, b.geometry)) > ${OVERLAP_EPSILON_M2}
      UNION ALL
      SELECT 'STAND_ON_RESERVED', ARRAY[s.id::text, r.id::text]
      FROM stands s JOIN o r ON r.kind IN ('AISLE', 'ENTRY', 'EXIT', 'EMERGENCY')
      WHERE s.valid AND r.valid AND ST_Intersects(s.geometry, r.geometry)
        AND ST_Area(ST_Intersection(s.geometry, r.geometry)) > ${OVERLAP_EPSILON_M2}
      UNION ALL
      SELECT 'CODE_MISSING', ARRAY[id::text] FROM stands WHERE coalesce(code, '') = ''
      UNION ALL
      SELECT 'CODE_DUPLICATE', array_agg(id::text ORDER BY id) FROM stands
      WHERE code <> '' GROUP BY code HAVING count(*) > 1
      UNION ALL
      SELECT 'NO_STANDS', ARRAY[]::text[] WHERE NOT EXISTS (SELECT 1 FROM stands)
    ) issues
    ORDER BY code, ids
  `);
  return rows.map((r) => ({
    code: r.code,
    objectIds: r.ids,
    message: MESSAGES[r.code],
  }));
}

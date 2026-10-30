/** Units: every coordinate and length is in meters. */

export type LayoutObjectKind =
  'STAND' | 'AISLE' | 'ENTRY' | 'EXIT' | 'UTILITY' | 'OBSTACLE' | 'EMERGENCY';

export type LayoutVersionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export type Position = readonly [number, number];

/** GeoJSON Polygon in a local planar frame (meters). First ring is the exterior. */
export interface PolygonGeometry {
  readonly type: 'Polygon';
  readonly coordinates: readonly (readonly Position[])[];
}

export interface LayoutObjectDto {
  readonly id: string;
  readonly kind: LayoutObjectKind;
  readonly code: string | null;
  readonly geometry: PolygonGeometry;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface LayoutVersionDto {
  readonly id: string;
  readonly templateId: string;
  readonly version: number;
  readonly status: LayoutVersionStatus;
  readonly widthM: number;
  readonly heightM: number;
  readonly objects: readonly LayoutObjectDto[];
}

/** Axis-aligned rectangle used for editing. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Bounds {
  readonly widthM: number;
  readonly heightM: number;
}

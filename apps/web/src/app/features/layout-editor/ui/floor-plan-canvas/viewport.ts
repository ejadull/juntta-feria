import { clamp } from '../../domain/geometry';
import type { Point } from '../../domain/commands';

/** Camera over the plan. Units are meters; only the SVG viewBox changes, never the data. */
export interface View {
  readonly zoom: number;
  readonly cx: number;
  readonly cy: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Margin around the venue, room for rulers. */
export const PAD_M = 3;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 8;

export function initialView(widthM: number, heightM: number): View {
  return { zoom: 1, cx: widthM / 2, cy: heightM / 2 };
}

export function viewBox(view: View, widthM: number, heightM: number): Box {
  const w = (widthM + 2 * PAD_M) / view.zoom;
  const h = (heightM + 2 * PAD_M) / view.zoom;
  return { x: view.cx - w / 2, y: view.cy - h / 2, w, h };
}

/** Zooms keeping `anchor` (plan coords) fixed on screen; without anchor, zooms around the center. */
export function zoomAt(view: View, factor: number, anchor?: Point): View {
  const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const k = zoom / view.zoom;
  const a = anchor ?? { x: view.cx, y: view.cy };
  return { zoom, cx: a.x - (a.x - view.cx) / k, cy: a.y - (a.y - view.cy) / k };
}

/** Meters per screen pixel for an SVG using preserveAspectRatio="xMidYMid meet". */
export function metersPerPixel(rect: ScreenRect, box: Box): number {
  return Math.max(box.w / rect.width, box.h / rect.height);
}

/**
 * Screen → plan without getScreenCTM (unavailable in jsdom), assuming xMidYMid meet:
 * the box is scaled uniformly and centered, leaving bars on one axis.
 */
export function screenToPlan(client: Point, rect: ScreenRect, box: Box): Point {
  const scale = metersPerPixel(rect, box);
  const barX = (rect.width * scale - box.w) / 2;
  const barY = (rect.height * scale - box.h) / 2;
  return {
    x: box.x - barX + (client.x - rect.left) * scale,
    y: box.y - barY + (client.y - rect.top) * scale,
  };
}

import { MAX_ZOOM, MIN_ZOOM, PAD_M, initialView, screenToPlan, viewBox, zoomAt } from './viewport';

describe('viewport', () => {
  it('starts centered on the venue with padding for rulers', () => {
    const view = initialView(100, 60);
    expect(view).toEqual({ zoom: 1, cx: 50, cy: 30 });
    expect(viewBox(view, 100, 60)).toEqual({
      x: -PAD_M,
      y: -PAD_M,
      w: 100 + 2 * PAD_M,
      h: 60 + 2 * PAD_M,
    });
  });

  it('shrinks the visible box when zooming in', () => {
    const box = viewBox({ zoom: 2, cx: 50, cy: 30 }, 100, 60);
    expect(box.w).toBeCloseTo((100 + 2 * PAD_M) / 2);
    expect(box.x + box.w / 2).toBeCloseTo(50);
  });

  it('keeps the anchor at the same relative screen position (zoom to cursor)', () => {
    const view = initialView(100, 60);
    const anchor = { x: 20, y: 10 };
    const before = viewBox(view, 100, 60);
    const after = viewBox(zoomAt(view, 1.7, anchor), 100, 60);
    expect((anchor.x - after.x) / after.w).toBeCloseTo((anchor.x - before.x) / before.w);
    expect((anchor.y - after.y) / after.h).toBeCloseTo((anchor.y - before.y) / before.h);
  });

  it('zooms around the center without an anchor and clamps the zoom range', () => {
    const view = initialView(100, 60);
    expect(zoomAt(view, 2)).toEqual({ zoom: 2, cx: 50, cy: 30 });
    expect(zoomAt(view, 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(view, 0.001).zoom).toBe(MIN_ZOOM);
  });

  it('maps screen pixels to meters', () => {
    const box = viewBox(initialView(100, 60), 100, 60); // 106 × 66 m
    const rect = { left: 0, top: 0, width: 1060, height: 660 }; // 10 px per meter
    expect(screenToPlan({ x: 130, y: 80 }, rect, box)).toEqual({ x: 10, y: 5 });
  });

  it('accounts for letterboxing (preserveAspectRatio xMidYMid meet) and element offset', () => {
    const box = viewBox(initialView(100, 60), 100, 60);
    const wide = { left: 100, top: 20, width: 2120, height: 660 }; // content centered, 530 px bars
    const p = screenToPlan({ x: 100 + 530, y: 20 }, wide, box);
    expect(p.x).toBeCloseTo(-PAD_M);
    expect(p.y).toBeCloseTo(-PAD_M);
  });
});

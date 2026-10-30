import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { toPolygon } from '../../domain/geometry';
import type { LayoutObjectDto, Rect } from '../../domain/layout.types';
import { FloorPlanCanvas } from './floor-plan-canvas';

const stand = (id: string, rect: Rect): LayoutObjectDto => ({
  id,
  kind: 'STAND',
  code: id,
  geometry: toPolygon(rect),
  metadata: {},
});
const aisle: LayoutObjectDto = {
  id: 'aisle',
  kind: 'AISLE',
  code: null,
  geometry: toPolygon({ x: 0, y: 28, w: 100, h: 4 }),
  metadata: {},
};
const pentagon: LayoutObjectDto = {
  id: 'p',
  kind: 'OBSTACLE',
  code: null,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [50, 50],
        [54, 50],
        [55, 53],
        [52, 55],
        [49, 53],
        [50, 50],
      ],
    ],
  },
  metadata: {},
};
const OBJECTS = [stand('A01', { x: 0, y: 0, w: 3, h: 3 }), aisle, pentagon];

/** jsdom has no layout: pin the SVG to 1060×660 px so 1 m = 10 px over the initial 106×66 m view box. */
const RECT = { left: 0, top: 0, width: 1060, height: 660, right: 1060, bottom: 660, x: 0, y: 0 };

function pointer(type: string, x: number, y: number, pointerId = 1): Event {
  const init = { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId };
  if (typeof PointerEvent !== 'undefined') return new PointerEvent(type, init);
  const event = new MouseEvent(type, init);
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

interface Setup {
  fixture: ComponentFixture<FloorPlanCanvas>;
  host: HTMLElement;
  svg: SVGSVGElement;
  emitted: Record<string, unknown[]>;
}

async function setup(
  inputs: Partial<Record<'selectedId' | 'readOnly' | 'invalidIds', unknown>> = {},
): Promise<Setup> {
  const fixture = TestBed.createComponent(FloorPlanCanvas);
  fixture.componentRef.setInput('widthM', 100);
  fixture.componentRef.setInput('heightM', 60);
  fixture.componentRef.setInput('objects', OBJECTS);
  Object.entries(inputs).forEach(([k, v]) => fixture.componentRef.setInput(k, v));

  const emitted: Record<string, unknown[]> = {
    select: [],
    dragStart: [],
    dragTo: [],
    resizeTo: [],
    dragEnd: [],
    dragCancel: [],
    keyAction: [],
  };
  const c = fixture.componentInstance;
  c.selectObject.subscribe((v) => emitted['select'].push(v));
  c.dragStart.subscribe(() => emitted['dragStart'].push(true));
  c.dragTo.subscribe((v) => emitted['dragTo'].push(v));
  c.resizeTo.subscribe((v) => emitted['resizeTo'].push(v));
  c.dragEnd.subscribe(() => emitted['dragEnd'].push(true));
  c.dragCancel.subscribe(() => emitted['dragCancel'].push(true));
  c.keyAction.subscribe((a) => emitted['keyAction'].push(a));

  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const svg = host.querySelector('svg') as SVGSVGElement;
  svg.getBoundingClientRect = () => RECT as DOMRect;
  return { fixture, host, svg, emitted };
}

const shapeEl = (host: HTMLElement, id: string) =>
  host.querySelector(`[data-id="${id}"]`) as SVGGElement;
const viewBoxOf = (svg: SVGSVGElement) => svg.getAttribute('viewBox')!.split(' ').map(Number);

describe('FloorPlanCanvas', () => {
  describe('rendering', () => {
    it('draws one labelled shape per object, in meters', async () => {
      const { host, svg } = await setup();
      expect(host.querySelectorAll('[data-id]')).toHaveLength(3);
      expect(viewBoxOf(svg)).toEqual([-3, -3, 106, 66]);
      expect(shapeEl(host, 'A01').querySelector('polygon')?.getAttribute('points')).toBe(
        '0,0 3,0 3,3 0,3 0,0',
      );
    });

    it('labels stands with code and area, other kinds with a Spanish name (not color only)', async () => {
      const { host } = await setup();
      expect(shapeEl(host, 'A01').getAttribute('aria-label')).toBe('Stand A01, 3 por 3 metros');
      expect(shapeEl(host, 'A01').textContent).toContain('9 m²');
      expect(shapeEl(host, 'aisle').textContent).toContain('Pasillo');
    });

    it('marks invalid objects with a class and a warning glyph', async () => {
      const { host } = await setup({ invalidIds: new Set(['A01']) });
      expect(shapeEl(host, 'A01').classList).toContain('invalid');
      expect(shapeEl(host, 'A01').textContent).toContain('⚠');
      expect(shapeEl(host, 'aisle').classList).not.toContain('invalid');
    });

    it('shows 8 resize handles on the selected rectangle', async () => {
      const { host } = await setup({ selectedId: 'A01' });
      expect(shapeEl(host, 'A01').classList).toContain('selected');
      expect(host.querySelectorAll('[data-handle]')).toHaveLength(8);
    });

    it('locks free polygons: drawn, but without handles (spec: "Polígono libre")', async () => {
      const { host } = await setup({ selectedId: 'p' });
      expect(shapeEl(host, 'p').classList).toContain('locked');
      expect(host.querySelectorAll('[data-handle]')).toHaveLength(0);
    });

    it('hides handles in read-only mode', async () => {
      const { host } = await setup({ selectedId: 'A01', readOnly: true });
      expect(host.querySelectorAll('[data-handle]')).toHaveLength(0);
    });
  });

  describe('pointer interaction', () => {
    it('drags an object: select, start, positions in meters, end', async () => {
      const { host, svg, emitted } = await setup();
      shapeEl(host, 'A01').dispatchEvent(pointer('pointerdown', 45, 45)); // (1.5, 1.5) m
      svg.dispatchEvent(pointer('pointermove', 145, 95)); // (11.5, 6.5) m
      svg.dispatchEvent(pointer('pointerup', 145, 95));

      expect(emitted['select']).toEqual(['A01']);
      expect(emitted['dragStart']).toHaveLength(1);
      expect(emitted['dragTo']).toEqual([{ id: 'A01', x: 10, y: 5 }]);
      expect(emitted['dragEnd']).toHaveLength(1);
    });

    it('selects without dragging in read-only mode or on free polygons', async () => {
      const ro = await setup({ readOnly: true });
      shapeEl(ro.host, 'A01').dispatchEvent(pointer('pointerdown', 45, 45));
      ro.svg.dispatchEvent(pointer('pointermove', 145, 95));
      expect(ro.emitted['select']).toEqual(['A01']);
      expect(ro.emitted['dragStart']).toHaveLength(0);
      expect(ro.emitted['dragTo']).toHaveLength(0);

      TestBed.resetTestingModule();
      const free = await setup();
      shapeEl(free.host, 'p').dispatchEvent(pointer('pointerdown', 550, 550));
      free.svg.dispatchEvent(pointer('pointermove', 600, 600));
      expect(free.emitted['dragTo']).toHaveLength(0);
    });

    it('resizes from a handle, emitting the pointer position in meters', async () => {
      const { host, svg, emitted } = await setup({ selectedId: 'A01' });
      host.querySelector('[data-handle="se"]')!.dispatchEvent(pointer('pointerdown', 60, 60));
      svg.dispatchEvent(pointer('pointermove', 80, 80));
      svg.dispatchEvent(pointer('pointerup', 80, 80));

      expect(emitted['dragStart']).toHaveLength(1);
      expect(emitted['resizeTo']).toEqual([{ id: 'A01', handle: 'se', x: 5, y: 5 }]);
      expect(emitted['dragEnd']).toHaveLength(1);
    });

    it('a click on empty floor clears the selection', async () => {
      const { svg, emitted } = await setup({ selectedId: 'A01' });
      svg.dispatchEvent(pointer('pointerdown', 500, 500));
      svg.dispatchEvent(pointer('pointerup', 500, 500));
      expect(emitted['select']).toEqual([null]);
    });

    it('pans when dragging empty floor, without clearing the selection', async () => {
      const { fixture, svg, emitted } = await setup();
      svg.dispatchEvent(pointer('pointerdown', 500, 300));
      svg.dispatchEvent(pointer('pointermove', 600, 300)); // 100 px = 10 m
      svg.dispatchEvent(pointer('pointerup', 600, 300));
      await fixture.whenStable();

      expect(viewBoxOf(svg)[0]).toBeCloseTo(-13);
      expect(emitted['select']).toEqual([]);
    });
  });

  describe('zoom', () => {
    it('zooms in on wheel up', async () => {
      const { fixture, svg } = await setup();
      svg.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -200, clientX: 30, clientY: 30, cancelable: true }),
      );
      await fixture.whenStable();
      expect(viewBoxOf(svg)[2]).toBeLessThan(106);
    });

    it('zoom buttons change and reset the view, and the badge shows the level', async () => {
      const { fixture, host, svg } = await setup();
      (host.querySelector('[aria-label="Acercar"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(viewBoxOf(svg)[2]).toBeCloseTo(106 / 1.3);
      expect(host.textContent).toContain('130%');

      (host.querySelector('[aria-label="Restablecer vista"]') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(viewBoxOf(svg)).toEqual([-3, -3, 106, 66]);
    });
  });

  describe('reveal selection (spec: "Lista sincronizada")', () => {
    const zoomInTimes = async (
      fixture: ComponentFixture<FloorPlanCanvas>,
      host: HTMLElement,
      n: number,
    ) => {
      for (let i = 0; i < n; i++)
        (host.querySelector('[aria-label="Acercar"]') as HTMLButtonElement).click();
      await fixture.whenStable();
    };

    it('pans to a selected object that is off-screen, keeping the zoom', async () => {
      const { fixture, host, svg } = await setup();
      await zoomInTimes(fixture, host, 6); // ~4.8×: view ≈ 22×14 m around (50, 30); A01 (0..3) is off-screen
      const [, , w0] = viewBoxOf(svg);

      fixture.componentRef.setInput('selectedId', 'A01');
      await fixture.whenStable();

      const [x, y, w, h] = viewBoxOf(svg);
      expect(w).toBeCloseTo(w0);
      expect(x).toBeLessThanOrEqual(1.5);
      expect(x + w).toBeGreaterThanOrEqual(1.5);
      expect(y).toBeLessThanOrEqual(1.5);
      expect(y + h).toBeGreaterThanOrEqual(1.5);
    });

    it('does not move the view when the selected object is already visible', async () => {
      const { fixture, svg } = await setup();
      const before = viewBoxOf(svg);
      fixture.componentRef.setInput('selectedId', 'A01');
      await fixture.whenStable();
      expect(viewBoxOf(svg)).toEqual(before);
    });
  });

  describe('keyboard (LUI-08)', () => {
    const press = (el: Element, key: string, mods: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods });
      el.dispatchEvent(e);
      return e;
    };

    it('makes the plan and every object focusable, with a descriptive name', async () => {
      const { host, svg } = await setup();
      expect(svg.getAttribute('tabindex')).toBe('0');
      expect(shapeEl(host, 'A01').getAttribute('tabindex')).toBe('0');
      expect(shapeEl(host, 'A01').getAttribute('aria-label')).toBe('Stand A01, 3 por 3 metros');
    });

    it('selects an object when it receives focus (Tab navigation)', async () => {
      const { host, emitted } = await setup();
      shapeEl(host, 'A01').dispatchEvent(new FocusEvent('focus'));
      expect(emitted['select']).toEqual(['A01']);
    });

    it('emits edit intents for shortcut keys and prevents the browser default', async () => {
      const { host, emitted } = await setup({ selectedId: 'A01' });
      const e = press(shapeEl(host, 'A01'), 'ArrowRight');
      press(shapeEl(host, 'A01'), 'd', { ctrlKey: true });
      expect(emitted['keyAction']).toEqual([
        { type: 'move', dx: 1, dy: 0, large: false },
        { type: 'duplicate' },
      ]);
      expect(e.defaultPrevented).toBe(true);
    });

    it('handles zoom keys itself and leaves unknown keys alone', async () => {
      const { fixture, svg, emitted } = await setup();
      press(svg, '+');
      const other = press(svg, 'a');
      await fixture.whenStable();
      expect(viewBoxOf(svg)[2]).toBeCloseTo(106 / 1.3);
      expect(emitted['keyAction']).toEqual([]);
      expect(other.defaultPrevented).toBe(false);
    });

    it('Escape clears the selection and keeps focus on the plan', async () => {
      const { host, svg, emitted } = await setup({ selectedId: 'A01' });
      press(shapeEl(host, 'A01'), 'Escape');
      expect(emitted['select']).toEqual([null]);
      expect(document.activeElement).toBe(svg);
    });

    it('focusObject moves focus to an object after the next render', async () => {
      const { fixture, host } = await setup();
      fixture.componentRef.setInput('objects', [
        ...OBJECTS,
        stand('A02', { x: 3, y: 0, w: 3, h: 3 }),
      ]);
      fixture.componentInstance.focusObject('A02');
      await fixture.whenStable();
      expect(document.activeElement).toBe(shapeEl(host, 'A02'));
    });
  });

  describe('pinch', () => {
    it('zooms 2× around the fingers midpoint on empty floor', async () => {
      const { fixture, svg } = await setup();
      svg.dispatchEvent(pointer('pointerdown', 490, 300, 1));
      svg.dispatchEvent(pointer('pointerdown', 510, 300, 2));
      svg.dispatchEvent(pointer('pointermove', 520, 300, 2));
      svg.dispatchEvent(pointer('pointermove', 480, 300, 1)); // 20 px → 40 px apart = 2×
      await fixture.whenStable();
      expect(viewBoxOf(svg)[2]).toBeCloseTo(53);
    });

    it('keeps the plan point under the fingers midpoint fixed when fingers move unevenly', async () => {
      const { fixture, svg } = await setup();
      // Start: 20 px apart around x=500 → plan x = -3 + 500/10 = 47 m.
      svg.dispatchEvent(pointer('pointerdown', 490, 300, 1));
      svg.dispatchEvent(pointer('pointerdown', 510, 300, 2));
      svg.dispatchEvent(pointer('pointermove', 530, 300, 2)); // 40 px, midpoint 510
      svg.dispatchEvent(pointer('pointermove', 470, 300, 1)); // 60 px = 3×, midpoint back at 500
      await fixture.whenStable();

      const [x, , w] = viewBoxOf(svg);
      expect(w).toBeCloseTo(106 / 3);
      expect(x + 500 * (w / 1060)).toBeCloseTo(47); // 47 m still under screen x=500
    });

    it('pinching over a stand zooms instead of dragging it, and cancels the started drag', async () => {
      const { fixture, host, svg, emitted } = await setup();
      shapeEl(host, 'A01').dispatchEvent(pointer('pointerdown', 10, 15, 1));
      shapeEl(host, 'A01').dispatchEvent(pointer('pointerdown', 20, 15, 2));
      svg.dispatchEvent(pointer('pointermove', 25, 15, 2));
      svg.dispatchEvent(pointer('pointermove', 5, 15, 1)); // 10 px → 20 px = 2×
      svg.dispatchEvent(pointer('pointerup', 5, 15, 1));
      svg.dispatchEvent(pointer('pointerup', 25, 15, 2));
      await fixture.whenStable();

      expect(viewBoxOf(svg)[2]).toBeCloseTo(53);
      expect(emitted['dragTo']).toEqual([]);
      expect(emitted['dragCancel']).toHaveLength(1);
      expect(emitted['dragEnd']).toHaveLength(0);
    });

    it('a second finger on the floor during a stand drag switches to pinch', async () => {
      const { fixture, host, svg, emitted } = await setup();
      shapeEl(host, 'A01').dispatchEvent(pointer('pointerdown', 15, 15, 1));
      svg.dispatchEvent(pointer('pointermove', 20, 15, 1)); // a small drag already happened
      svg.dispatchEvent(pointer('pointerdown', 40, 15, 2)); // 20 px apart
      svg.dispatchEvent(pointer('pointermove', 60, 15, 2)); // 40 px apart = 2×
      await fixture.whenStable();

      expect(emitted['dragTo']).toHaveLength(1);
      expect(emitted['dragCancel']).toHaveLength(1);
      expect(viewBoxOf(svg)[2]).toBeCloseTo(53);
    });
  });
});

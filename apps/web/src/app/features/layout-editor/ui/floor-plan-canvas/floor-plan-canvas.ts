import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import type { Point, ResizeHandle } from '../../domain/commands';
import { fromPolygon, round2 } from '../../domain/geometry';
import type { LayoutObjectDto, LayoutObjectKind, Rect } from '../../domain/layout.types';
import { KIND_LABEL } from '../../domain/validation';
import type { EditorAction } from '../../state/editor-actions';
import { keyToAction } from './keymap';
import { initialView, metersPerPixel, screenToPlan, viewBox, zoomAt, type View } from './viewport';

export interface DragToEvent {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface ResizeToEvent extends DragToEvent {
  readonly handle: ResizeHandle;
}

interface Shape {
  readonly id: string;
  readonly kind: LayoutObjectKind;
  readonly points: string;
  readonly rect: Rect | null;
  readonly label: string;
  readonly sublabel: string;
  readonly aria: string;
  readonly center: Point;
  readonly fontSize: number;
  readonly invalid: boolean;
}

type Drag =
  | { kind: 'pan'; start: Point; startView: View; scale: number; moved: boolean }
  | { kind: 'move'; id: string; start: Point; origin: Point }
  | { kind: 'resize'; id: string; handle: ResizeHandle }
  | { kind: 'pinch'; startDist: number; startView: View };

const HANDLES: readonly ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const ZOOM_STEP = 1.3;
const WHEEL_SENSITIVITY = 0.0018;
const CLICK_TOLERANCE_PX = 3;
const RULER_STEP_M = 5;

const fmt = (v: number): string => String(round2(v));

function toShape(o: LayoutObjectDto, invalid: boolean): Shape {
  const ring = o.geometry.coordinates[0] ?? [];
  const rect = fromPolygon(o.geometry);
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const center = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
  const name = o.kind === 'STAND' ? o.code?.trim() || 'Sin código' : KIND_LABEL[o.kind];
  const size = rect ? `${fmt(rect.w)} por ${fmt(rect.h)} metros` : 'forma libre';
  const minSide = rect ? Math.min(rect.w, rect.h) : 2;
  return {
    id: o.id,
    kind: o.kind,
    points: ring.map(([x, y]) => `${x},${y}`).join(' '),
    rect,
    label: name,
    sublabel: o.kind === 'STAND' && rect ? `${fmt(rect.w * rect.h)} m²` : '',
    aria: `${o.kind === 'STAND' ? `Stand ${name}` : name}, ${size}`,
    center,
    fontSize: Math.min(0.75, minSide / 3),
    invalid,
  };
}

function handlePoint(r: Rect, h: ResizeHandle): Point {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

/**
 * Presentational SVG plan. 1 SVG unit = 1 m. Knows nothing about the store:
 * it renders inputs and emits intents; the page decides what they mean.
 */
@Component({
  selector: 'app-floor-plan-canvas',
  templateUrl: './floor-plan-canvas.html',
  styleUrl: './floor-plan-canvas.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FloorPlanCanvas {
  readonly widthM = input.required<number>();
  readonly heightM = input.required<number>();
  readonly objects = input.required<readonly LayoutObjectDto[]>();
  readonly selectedId = input<string | null>(null);
  readonly invalidIds = input<ReadonlySet<string>>(new Set());
  readonly readOnly = input(false);

  readonly selectObject = output<string | null>();
  readonly dragStart = output<void>();
  readonly dragTo = output<DragToEvent>();
  readonly resizeTo = output<ResizeToEvent>();
  readonly dragEnd = output<void>();
  /** A started move/resize was abandoned (a second finger turned it into a pinch). */
  readonly dragCancel = output<void>();
  /** Keyboard edit intents (design D7). Zoom and Escape are handled here and not emitted. */
  readonly keyAction = output<EditorAction>();

  private readonly injector = inject(Injector);
  private readonly svgRef = viewChild.required<ElementRef<SVGSVGElement>>('svg');

  protected readonly view = linkedSignal(() => initialView(this.widthM(), this.heightM()));
  protected readonly box = computed(() => viewBox(this.view(), this.widthM(), this.heightM()));
  protected readonly viewBoxAttr = computed(() => {
    const b = this.box();
    return `${b.x} ${b.y} ${b.w} ${b.h}`;
  });
  protected readonly zoomPercent = computed(() => Math.round(this.view().zoom * 100));
  protected readonly ariaLabel = computed(
    () => `Plano del predio, ${this.widthM()} por ${this.heightM()} metros`,
  );

  protected readonly shapes = computed(() => {
    const invalid = this.invalidIds();
    return this.objects().map((o) => toShape(o, invalid.has(o.id)));
  });

  protected readonly handles = computed(() => {
    if (this.readOnly()) return [];
    const rect = this.shapes().find((s) => s.id === this.selectedId())?.rect;
    if (!rect) return [];
    const size = 0.5 / this.view().zoom;
    return HANDLES.map((handle) => {
      const p = handlePoint(rect, handle);
      return { handle, x: p.x - size / 2, y: p.y - size / 2, size };
    });
  });

  protected readonly gridLines = computed(() => {
    const w = this.widthM();
    const h = this.heightM();
    const vertical = Array.from({ length: Math.floor(w) + 1 }, (_, x) => ({
      key: `x${x}`,
      x1: x,
      y1: 0,
      x2: x,
      y2: h,
      major: x % 5 === 0,
    }));
    const horizontal = Array.from({ length: Math.floor(h) + 1 }, (_, y) => ({
      key: `y${y}`,
      x1: 0,
      y1: y,
      x2: w,
      y2: y,
      major: y % 5 === 0,
    }));
    return [...vertical, ...horizontal];
  });

  protected readonly rulerX = computed(() => this.rulerMarks(this.widthM()));
  protected readonly rulerY = computed(() => this.rulerMarks(this.heightM()));

  private drag: Drag | null = null;
  private readonly pointers = new Map<number, Point>();

  constructor() {
    // Selection coming from outside (list, validation panel, new object) must be visible.
    // Only selectedId is tracked: re-checking on every move would fight a drag.
    effect(() => {
      const id = this.selectedId();
      untracked(() => this.reveal(id));
    });
  }

  /** Current view center in meters (e.g. where to drop a new object). */
  viewCenter(): Point {
    const { cx, cy } = this.view();
    return { x: cx, y: cy };
  }

  /** Focus an object once it is rendered (e.g. a copy that does not exist in the DOM yet). */
  focusObject(id: string): void {
    afterNextRender(
      () =>
        this.svgRef()
          .nativeElement.querySelector<SVGGElement>(`[data-id="${CSS.escape(id)}"]`)
          ?.focus(),
      { injector: this.injector },
    );
  }

  /** Focus the plan itself (e.g. after the focused object was removed). */
  focusPlan(): void {
    this.svgRef().nativeElement.focus();
  }

  protected onKey(e: KeyboardEvent): void {
    const action = keyToAction(e);
    if (!action) return;
    e.preventDefault();
    switch (action.type) {
      case 'zoom':
        if (action.dir === 'in') this.zoomIn();
        else if (action.dir === 'out') this.zoomOut();
        else this.resetView();
        return;
      case 'deselect':
        this.selectObject.emit(null);
        this.focusPlan();
        return;
      default:
        this.keyAction.emit(action);
    }
  }

  protected zoomIn(): void {
    this.view.update((v) => zoomAt(v, ZOOM_STEP));
  }

  protected zoomOut(): void {
    this.view.update((v) => zoomAt(v, 1 / ZOOM_STEP));
  }

  protected resetView(): void {
    this.view.set(initialView(this.widthM(), this.heightM()));
  }

  protected onWheel(e: WheelEvent): void {
    e.preventDefault();
    const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const anchor = this.toPlan(e);
    this.view.update((v) => zoomAt(v, Math.exp(-e.deltaY * lines * WHEEL_SENSITIVITY), anchor));
  }

  protected onShapeDown(e: PointerEvent, shape: Shape): void {
    e.stopPropagation();
    if (this.trackPointer(e)) return;
    this.selectObject.emit(shape.id);
    if (this.readOnly() || !shape.rect) return;
    this.drag = {
      kind: 'move',
      id: shape.id,
      start: this.toPlan(e),
      origin: { x: shape.rect.x, y: shape.rect.y },
    };
    this.dragStart.emit();
  }

  protected onHandleDown(e: PointerEvent, handle: ResizeHandle): void {
    e.stopPropagation();
    if (this.trackPointer(e)) return;
    const id = this.selectedId();
    if (!id) return;
    this.drag = { kind: 'resize', id, handle };
    this.dragStart.emit();
  }

  protected onBackgroundDown(e: PointerEvent): void {
    if (this.trackPointer(e)) return;
    const scale = metersPerPixel(this.svgRect(), this.box());
    this.drag = {
      kind: 'pan',
      start: { x: e.clientX, y: e.clientY },
      startView: this.view(),
      scale,
      moved: false,
    };
  }

  protected onPointerMove(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId))
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = this.drag;
    if (!d) return;

    switch (d.kind) {
      case 'pan': {
        const dx = e.clientX - d.start.x;
        const dy = e.clientY - d.start.y;
        if (Math.abs(dx) + Math.abs(dy) > CLICK_TOLERANCE_PX) d.moved = true;
        this.view.set({
          ...d.startView,
          cx: d.startView.cx - dx * d.scale,
          cy: d.startView.cy - dy * d.scale,
        });
        break;
      }
      case 'move': {
        const p = this.toPlan(e);
        this.dragTo.emit({
          id: d.id,
          x: d.origin.x + p.x - d.start.x,
          y: d.origin.y + p.y - d.start.y,
        });
        break;
      }
      case 'resize':
        this.resizeTo.emit({ id: d.id, handle: d.handle, ...this.toPlan(e) });
        break;
      case 'pinch': {
        // Anchor in the start view's frame: zoomAt(startView, …) keeps that point under the midpoint.
        const [a, b] = [...this.pointers.values()];
        const startBox = viewBox(d.startView, this.widthM(), this.heightM());
        const mid = screenToPlan(
          { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          this.svgRect(),
          startBox,
        );
        this.view.set(zoomAt(d.startView, this.pointerDistance() / d.startDist, mid));
        break;
      }
    }
  }

  protected onPointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (d?.kind === 'pinch' && this.pointers.size > 0) return; // wait for the last finger
    this.drag = null;
    if (d?.kind === 'move' || d?.kind === 'resize') this.dragEnd.emit();
    if (d?.kind === 'pan' && !d.moved) this.selectObject.emit(null);
  }

  /** Pans (keeping the zoom) so the object's center is on screen; no-op when already visible. */
  private reveal(id: string | null): void {
    const center = this.shapes().find((s) => s.id === id)?.center;
    if (!center) return;
    const b = this.box();
    const visible =
      center.x >= b.x && center.x <= b.x + b.w && center.y >= b.y && center.y <= b.y + b.h;
    if (!visible) this.view.update((v) => ({ ...v, cx: center.x, cy: center.y }));
  }

  private rulerMarks(lengthM: number): number[] {
    return Array.from(
      { length: Math.floor(lengthM / RULER_STEP_M) + 1 },
      (_, i) => i * RULER_STEP_M,
    );
  }

  private svgRect(): DOMRect {
    return this.svgRef().nativeElement.getBoundingClientRect();
  }

  private toPlan(e: { clientX: number; clientY: number }): Point {
    return screenToPlan({ x: e.clientX, y: e.clientY }, this.svgRect(), this.box());
  }

  /**
   * Every pointerdown (floor, shape or handle) registers its pointer, so two fingers
   * always mean pinch, wherever they land. Returns true when a pinch just started.
   */
  private trackPointer(e: PointerEvent): boolean {
    this.svgRef().nativeElement.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size !== 2) return false;
    if (this.drag?.kind === 'move' || this.drag?.kind === 'resize') this.dragCancel.emit();
    this.drag = { kind: 'pinch', startDist: this.pointerDistance(), startView: this.view() };
    return true;
  }

  private pointerDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }
}

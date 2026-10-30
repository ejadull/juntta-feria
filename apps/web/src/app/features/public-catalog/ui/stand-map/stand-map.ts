import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { fromPolygon, round2 } from '../../../layout-editor/domain/geometry';
import type { Point } from '../../../layout-editor/domain/commands';
import {
  initialView,
  metersPerPixel,
  screenToPlan,
  viewBox,
  zoomAt,
  type View,
} from '../../../layout-editor/ui/floor-plan-canvas/viewport';
import { formatArs } from '../../../../shared/money';
import {
  STATUS_LABEL,
  type PublicMapDto,
  type PublicStandStatus,
} from '../../data/public-catalog.repository';
import {
  countByStatus,
  matchesFilter,
  NO_FILTER,
  sectorOutlines,
  standsOf,
  type StandFilter,
  type StandView,
} from '../../domain/stand-filters';

const STATUSES: readonly PublicStandStatus[] = ['AVAILABLE', 'RESERVED', 'OCCUPIED', 'BLOCKED'];
const ZOOM_STEP = 1.3;
const WHEEL_SENSITIVITY = 0.0018;
let nextId = 0;

function ariaLabel(s: StandView): string {
  const parts = [
    `Stand ${s.code}`,
    s.sector ?? 'Sin sector',
    `${s.areaM2} m²`,
    STATUS_LABEL[s.status],
  ];
  if (s.exhibitor) parts.push(s.exhibitor.name);
  parts.push(formatArs(s.priceCents));
  return parts.join(', ');
}

/**
 * Read-only public map (design D4). Commercial states live here, never in the editor (INV-03).
 * Presentational: renders inputs, emits the selected stand id.
 */
@Component({
  selector: 'app-stand-map',
  templateUrl: './stand-map.html',
  styleUrl: './stand-map.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StandMap {
  readonly map = input.required<PublicMapDto>();
  readonly selectedId = input<string | null>(null);
  /** Feriante filters: stands outside them are dimmed, not hidden (the plan keeps its context). */
  readonly filter = input<StandFilter>(NO_FILTER);

  readonly select = output<string>();

  protected readonly hatchId = `stand-hatch-${nextId++}`;
  protected readonly statuses = STATUSES;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly statusFilter = signal<PublicStandStatus | null>(null);
  protected readonly showGrid = signal(true);

  private readonly svgRef = viewChild.required<ElementRef<SVGSVGElement>>('svg');
  private readonly width = computed(() => this.map().bounds.width);
  private readonly height = computed(() => this.map().bounds.height);

  protected readonly view = linkedSignal(() => initialView(this.width(), this.height()));
  protected readonly box = computed(() => viewBox(this.view(), this.width(), this.height()));
  protected readonly viewBoxAttr = computed(() => {
    const b = this.box();
    return `${b.x} ${b.y} ${b.w} ${b.h}`;
  });
  protected readonly zoomPercent = computed(() => Math.round(this.view().zoom * 100));

  private readonly standViews = computed(() => standsOf(this.map()));
  protected readonly counts = computed(() => countByStatus(this.standViews()));
  protected readonly outlines = computed(() => sectorOutlines(this.standViews()));

  protected readonly stands = computed(() => {
    const filter = this.filter();
    const status = this.statusFilter();
    return this.standViews().map((s) => ({
      ...s,
      aria: ariaLabel(s),
      dimmed: !matchesFilter(s, filter) || (status !== null && s.status !== status),
      fontSize: Math.min(0.8, Math.min(s.w, s.h) / 3),
    }));
  });

  protected readonly areas = computed(() =>
    this.map().features.flatMap((f) => {
      const p = f.properties;
      if (p.kind === 'STAND') return [];
      const rect = fromPolygon(f.geometry);
      const ring = f.geometry.coordinates[0] ?? [];
      const minSide = rect ? Math.min(rect.w, rect.h) : 2;
      const label =
        p.kind === 'AISLE' && rect && p.label ? `${p.label} · ${round2(minSide)} m` : p.label;
      return [
        {
          kind: p.kind,
          label,
          points: ring.map(([x, y]) => `${x},${y}`).join(' '),
          cx: rect ? rect.x + rect.w / 2 : (ring[0]?.[0] ?? 0),
          cy: rect ? rect.y + rect.h / 2 : (ring[0]?.[1] ?? 0),
          fontSize: Math.min(0.7, minSide * 0.32),
        },
      ];
    }),
  );

  protected readonly gridLines = computed(() => {
    const [w, h] = [this.width(), this.height()];
    return [
      ...Array.from({ length: Math.floor(w) + 1 }, (_, x) => ({
        key: `x${x}`,
        x1: x,
        y1: 0,
        x2: x,
        y2: h,
        major: x % 5 === 0,
      })),
      ...Array.from({ length: Math.floor(h) + 1 }, (_, y) => ({
        key: `y${y}`,
        x1: 0,
        y1: y,
        x2: w,
        y2: y,
        major: y % 5 === 0,
      })),
    ];
  });

  private pan: { start: Point; startView: View; scale: number } | null = null;

  protected toggleStatus(status: PublicStandStatus | null): void {
    this.statusFilter.set(this.statusFilter() === status ? null : status);
  }

  protected zoomIn(): void {
    this.view.update((v) => zoomAt(v, ZOOM_STEP));
  }

  protected zoomOut(): void {
    this.view.update((v) => zoomAt(v, 1 / ZOOM_STEP));
  }

  protected resetView(): void {
    this.view.set(initialView(this.width(), this.height()));
  }

  protected onWheel(e: WheelEvent): void {
    e.preventDefault();
    const anchor = screenToPlan({ x: e.clientX, y: e.clientY }, this.svgRect(), this.box());
    this.view.update((v) => zoomAt(v, Math.exp(-e.deltaY * WHEEL_SENSITIVITY), anchor));
  }

  protected onStandKey(e: KeyboardEvent, id: string): void {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    this.select.emit(id);
  }

  protected onPointerDown(e: PointerEvent): void {
    if ((e.target as Element).closest?.('g.stand')) return; // stands handle their own click
    this.svgRef().nativeElement.setPointerCapture?.(e.pointerId);
    this.pan = {
      start: { x: e.clientX, y: e.clientY },
      startView: this.view(),
      scale: metersPerPixel(this.svgRect(), this.box()),
    };
  }

  protected onPointerMove(e: PointerEvent): void {
    const p = this.pan;
    if (!p) return;
    this.view.set({
      ...p.startView,
      cx: p.startView.cx - (e.clientX - p.start.x) * p.scale,
      cy: p.startView.cy - (e.clientY - p.start.y) * p.scale,
    });
  }

  protected onPointerUp(): void {
    this.pan = null;
  }

  private svgRect(): DOMRect {
    return this.svgRef().nativeElement.getBoundingClientRect();
  }
}

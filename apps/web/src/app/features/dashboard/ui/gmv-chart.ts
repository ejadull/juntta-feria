import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatArs, formatArsMillions, formatMonth, isMillionsScale } from '../../../shared/money';

interface Point {
  readonly month: string;
  readonly cents: number;
}

const SLOT = 100; // SVG units per month
const PLOT_H = 160; // tallest bar
const TOP = 28; // room for the value label
const BOTTOM = 28; // room for the month label

/** Monthly approved GMV (design D3): bars with values as text, plus an equivalent table. */
@Component({
  selector: 'app-gmv-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (bars().length === 0) {
      <p class="py-10 text-center text-sm text-text-muted">Sin ventas aprobadas todavía.</p>
    } @else {
      <svg
        [attr.viewBox]="'0 0 ' + width() + ' ' + height"
        class="h-56 w-full"
        role="img"
        [attr.aria-label]="summary()"
      >
        <line
          x1="0"
          [attr.x2]="width()"
          [attr.y1]="TOP + PLOT_H"
          [attr.y2]="TOP + PLOT_H"
          class="axis"
        />
        @for (b of bars(); track b.month) {
          <rect
            class="bar"
            [class.current]="b.current"
            [attr.x]="b.x"
            [attr.y]="b.y"
            [attr.width]="b.w"
            [attr.height]="b.h"
            rx="6"
          />
          <text class="value" [attr.x]="b.cx" [attr.y]="b.y - 8" text-anchor="middle">
            {{ b.value }}
          </text>
          <text class="month" [attr.x]="b.cx" [attr.y]="TOP + PLOT_H + 20" text-anchor="middle">
            {{ b.label }}
          </text>
        }
      </svg>
      <details class="mt-2 text-sm">
        <summary class="cursor-pointer text-text-muted">Ver datos</summary>
        <table class="mt-2 w-full max-w-sm">
          <thead>
            <tr class="text-left text-text-muted">
              <th scope="col" class="py-1 font-medium">Mes</th>
              <th scope="col" class="py-1 text-right font-medium">GMV aprobado</th>
            </tr>
          </thead>
          <tbody>
            @for (b of bars(); track b.month) {
              <tr class="border-t border-border">
                <td class="py-1">{{ b.label }}</td>
                <td class="py-1 text-right tabular-nums">{{ b.full }}</td>
              </tr>
            }
          </tbody>
        </table>
      </details>
    }
  `,
  styles: `
    .axis {
      stroke: var(--color-border);
    }
    .bar {
      fill: color-mix(in srgb, var(--color-primary) 22%, var(--color-surface));
    }
    .bar.current {
      fill: var(--color-primary);
    }
    .value {
      font-size: 13px;
      fill: var(--color-text);
    }
    .month {
      font-size: 13px;
      fill: var(--color-text-muted);
    }
  `,
})
export class GmvChart {
  readonly points = input.required<readonly Point[]>();

  protected readonly TOP = TOP;
  protected readonly PLOT_H = PLOT_H;
  protected readonly height = TOP + PLOT_H + BOTTOM;
  protected readonly width = computed(() => Math.max(1, this.points().length) * SLOT);

  protected readonly bars = computed(() => {
    const points = this.points();
    const max = Math.max(1, ...points.map((p) => p.cents));
    // One unit for all labels: if the largest bar is in millions, every bar is.
    const label = isMillionsScale(max) ? formatArsMillions : (c: number) => formatArs(c);
    return points.map((p, i) => {
      const h = Math.max(2, (p.cents / max) * PLOT_H);
      return {
        month: p.month,
        label: formatMonth(p.month),
        value: label(p.cents),
        full: formatArs(p.cents),
        x: i * SLOT + SLOT * 0.2,
        w: SLOT * 0.6,
        cx: i * SLOT + SLOT / 2,
        y: TOP + PLOT_H - h,
        h,
        current: i === points.length - 1,
      };
    });
  });

  protected readonly summary = computed(() => {
    const bars = this.bars();
    const top = bars.reduce((a, b) => (b.h > a.h ? b : a), bars[0]);
    return `GMV aprobado por mes, de ${bars[0].label} a ${bars.at(-1)!.label}. Máximo en ${top.label}: ${top.full}.`;
  });
}

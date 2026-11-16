import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-kpi-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-ui': 'metric', class: 'block rounded-xl border border-border bg-surface px-4 py-3' },
  template: `
    <p class="text-sm font-medium text-text-muted">{{ label() }}</p>
    <p class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{{ value() }}</p>
    <p class="text-xs text-text-muted">{{ detail() }}</p>
  `,
})
export class KpiCard {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly detail = input('');
}

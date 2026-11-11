import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-kpi-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-ui': 'metric', class: 'block rounded-2xl border border-border bg-surface p-5' },
  template: `
    <p class="text-sm font-medium text-text-muted">{{ label() }}</p>
    <p class="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{{ value() }}</p>
    <p class="mt-1 text-sm text-text-muted">{{ detail() }}</p>
  `,
})
export class KpiCard {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly detail = input('');
}

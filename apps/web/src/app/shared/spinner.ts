import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Indeterminate loading indicator (styles.css `.loading-spinner`). The ring is decorative; the
 * visually hidden label is what a screen reader announces through the status role.
 */
@Component({
  selector: 'app-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-2', role: 'status' },
  template: `
    <progress class="loading-spinner" aria-hidden="true"></progress>
    <span [class.sr-only]="!visibleLabel()">{{ label() }}</span>
  `,
})
export class Spinner {
  readonly label = input('Cargando…');
  /** Shows the label next to the ring instead of only announcing it. */
  readonly visibleLabel = input(false);
}

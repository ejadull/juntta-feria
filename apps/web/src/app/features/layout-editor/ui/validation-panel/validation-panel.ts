import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { ValidationIssue } from '../../domain/validation';

/** Validation issues with icon + text (never color only); clicking one selects the affected object. */
@Component({
  selector: 'app-validation-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="mb-3 text-sm font-semibold text-text">Validación</h2>
    @if (issues().length === 0) {
      <p class="text-sm text-primary-strong">✓ Sin errores. La versión se puede publicar.</p>
    } @else {
      <p class="mb-2 text-sm font-medium text-danger">
        {{ issues().length === 1 ? '1 error bloquea' : issues().length + ' errores bloquean' }} la
        publicación
      </p>
      <ul class="flex flex-col gap-1">
        @for (issue of issues(); track $index) {
          <li class="text-sm">
            @if (issue.objectIds.length > 0) {
              <button type="button" class="issue" (click)="select.emit(issue.objectIds[0])">
                <span aria-hidden="true">⚠</span> {{ issue.message }}
              </button>
            } @else {
              <span class="issue"><span aria-hidden="true">⚠</span> {{ issue.message }}</span>
            }
          </li>
        }
      </ul>
    }
    @if (serverIssues().length > 0) {
      <h3 class="mt-4 mb-2 text-sm font-semibold text-text">Rechazado por el servidor</h3>
      <ul class="flex flex-col gap-1">
        @for (issue of serverIssues(); track $index) {
          <li class="text-sm">
            @if (issue.objectIds.length > 0) {
              <button type="button" class="issue" (click)="select.emit(issue.objectIds[0])">
                <span aria-hidden="true">⚠</span> {{ issue.message }}
              </button>
            } @else {
              <span class="issue"><span aria-hidden="true">⚠</span> {{ issue.message }}</span>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .issue {
      display: block;
      width: 100%;
      padding: 0.375rem 0.5rem;
      border-radius: 0.375rem;
      /* Text stays in --color-text: danger on a danger tint would drop below 4.5:1. */
      background: color-mix(in srgb, var(--color-danger) 8%, var(--color-surface));
      box-shadow: inset 3px 0 0 var(--color-danger);
      color: var(--color-text);
      text-align: left;
    }
    button.issue:hover {
      background: color-mix(in srgb, var(--color-danger) 14%, var(--color-surface));
    }
    button.issue:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: 1px;
    }
  `,
})
export class ValidationPanel {
  readonly issues = input.required<readonly ValidationIssue[]>();
  readonly serverIssues = input<readonly ValidationIssue[]>([]);

  readonly select = output<string>();
}

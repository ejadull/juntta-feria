import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { THEMES, ThemeStore } from './theme';

/** Palette selector: native radios (keyboard and screen readers for free) with a 3-color preview. */
@Component({
  selector: 'app-theme-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset>
      <legend class="mb-1.5 text-xs font-semibold tracking-wider text-text-muted">
        Tema de colores
      </legend>
      <div class="grid gap-1">
        @for (t of themes; track t.id) {
          <label class="option">
            <input
              type="radio"
              name="juntta-theme"
              [value]="t.id"
              [checked]="t.id === theme.current()"
              (change)="theme.set(t.id)"
            />
            <span class="swatches" aria-hidden="true">
              @for (color of t.swatches; track $index) {
                <span [style.background]="color"></span>
              }
            </span>
            {{ t.label }}
          </label>
        }
      </div>
    </fieldset>
  `,
  styles: `
    fieldset {
      border: 0;
      margin: 0;
      padding: 0;
      min-width: 0;
    }
    .option {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      padding: 0.375rem 0.5rem;
      font-size: 0.875rem;
      cursor: pointer;
    }
    .option:hover {
      background: color-mix(in srgb, var(--color-text) 6%, transparent);
    }
    .option:has(input:checked) {
      border-color: var(--color-border-strong);
      background: var(--color-surface);
      font-weight: 600;
    }
    .option:has(input:focus-visible) {
      outline: 2px solid var(--color-selected);
      outline-offset: 2px;
    }
    input {
      accent-color: var(--color-primary);
      margin: 0;
    }
    .swatches {
      display: inline-flex;
    }
    .swatches span {
      width: 0.875rem;
      height: 0.875rem;
      border-radius: 999px;
      border: 1px solid var(--color-border-strong);
      margin-left: -0.25rem;
    }
    .swatches span:first-child {
      margin-left: 0;
    }
  `,
})
export class ThemePicker {
  protected readonly theme = inject(ThemeStore);
  protected readonly themes = THEMES;
}

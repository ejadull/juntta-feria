import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { THEMES, ThemeStore, type ThemeId } from './theme';

/** Palette pick list: a native select (keyboard and screen readers for free) with a 3-color preview. */
@Component({
  selector: 'app-theme-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="block text-xs font-semibold tracking-wider text-text-muted" for="juntta-theme">
      Tema de colores
    </label>
    <div class="mt-1.5 flex items-center gap-2">
      <select id="juntta-theme" class="theme-select" (change)="choose($event)">
        @for (t of themes; track t.id) {
          <option [value]="t.id" [selected]="t.id === theme.current()">{{ t.label }}</option>
        }
      </select>
      <span class="swatches" aria-hidden="true">
        @for (color of swatches(); track $index) {
          <span [style.background]="color"></span>
        }
      </span>
    </div>
  `,
  styles: `
    .theme-select {
      flex: 1;
      min-width: 0;
      min-height: 2.25rem;
      border: 1px solid var(--color-border-strong);
      border-radius: 0.5rem;
      background: var(--color-surface);
      color: var(--color-text);
      font-size: 0.875rem;
    }
    .theme-select:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: 2px;
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
  protected readonly swatches = computed(
    () => THEMES.find((t) => t.id === this.theme.current())?.swatches ?? [],
  );

  protected choose(event: Event): void {
    this.theme.set((event.target as HTMLSelectElement).value as ThemeId);
  }
}

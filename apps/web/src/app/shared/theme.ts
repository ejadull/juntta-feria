import { Injectable, signal } from '@angular/core';

export type ThemeId = 'clasico' | 'corporativo' | 'grafito' | 'industrial';

/** Corporativo = docs/paleta1.webp, Grafito = docs/paleta2.webp, Industrial = "Industrial Neon". */
export const THEMES: readonly { readonly id: ThemeId; readonly label: string }[] = [
  { id: 'clasico', label: 'Clásico' },
  { id: 'corporativo', label: 'Corporativo' },
  { id: 'grafito', label: 'Grafito' },
  { id: 'industrial', label: 'Industrial Neon' },
];

/** Same key index.html reads before Angular boots, so the page never flashes the other palette. */
export const THEME_STORAGE_KEY = 'juntta.theme';

const isTheme = (value: unknown): value is ThemeId => THEMES.some((t) => t.id === value);

/** Default palette when the browser has no choice saved (also in index.html). */
export const DEFAULT_THEME: ThemeId = 'grafito';

function stored(): ThemeId {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME; // storage blocked: the default palette still applies
  }
}

/** Palette choice (styles.css `:root[data-theme]`), per browser. */
@Injectable({ providedIn: 'root' })
export class ThemeStore {
  private readonly theme = signal<ThemeId>(stored());
  readonly current = this.theme.asReadonly();

  constructor() {
    this.apply(this.theme());
  }

  set(theme: ThemeId): void {
    this.theme.set(theme);
    this.apply(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ponytail: not remembered when storage is blocked; the choice still applies now
    }
  }

  private apply(theme: ThemeId): void {
    const root = document.documentElement;
    if (theme === 'clasico') delete root.dataset['theme'];
    else root.dataset['theme'] = theme;
  }
}

import { Injectable, signal } from '@angular/core';

export type ThemeId = 'clasico' | 'corporativo' | 'grafito' | 'industrial' | 'matcha';

/** Corporativo = docs/paleta1.webp, Grafito = docs/paleta2.webp, Industrial = "Industrial Neon". */
export interface ThemeOption {
  readonly id: ThemeId;
  readonly label: string;
  /** Preview of the palette (structure, accent, base): raw hex on purpose, they are other themes. */
  readonly swatches: readonly [string, string, string];
}

export const THEMES: readonly ThemeOption[] = [
  { id: 'clasico', label: 'Clásico', swatches: ['#055851', '#d94f80', '#faf9f7'] },
  { id: 'corporativo', label: 'Corporativo', swatches: ['#1e293b', '#0f766e', '#f8fafc'] },
  { id: 'grafito', label: 'Grafito', swatches: ['#1a1a1d', '#ff5a00', '#e0e0e2'] },
  { id: 'industrial', label: 'Industrial Neon', swatches: ['#3b3f46', '#c6ff3d', '#eef0f2'] },
  { id: 'matcha', label: 'Matcha Organic', swatches: ['#b9c9a0', '#ff3355', '#f2ebdd'] },
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

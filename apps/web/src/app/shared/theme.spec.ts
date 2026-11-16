import { TestBed } from '@angular/core/testing';
import { THEME_CHROME, THEME_STORAGE_KEY, THEMES, ThemeStore } from './theme';

describe('ThemeStore', () => {
  const root = document.documentElement;

  afterEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    delete root.dataset['theme'];
  });

  it('starts with the Grafito palette (docs/paleta2.webp) when nothing was chosen', () => {
    const theme = TestBed.inject(ThemeStore);
    expect(theme.current()).toBe('industrial');
    expect(root.dataset['theme']).toBe('industrial');
  });

  it('keeps the classic palette when the user chose it', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'clasico');
    TestBed.inject(ThemeStore);
    expect(root.dataset['theme']).toBeUndefined();
  });

  it('applies and remembers the corporate palette', () => {
    TestBed.inject(ThemeStore).set('corporativo');
    expect(root.dataset['theme']).toBe('corporativo');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('corporativo');

    TestBed.resetTestingModule();
    expect(TestBed.inject(ThemeStore).current()).toBe('corporativo');
  });

  it('ignores an unknown stored value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(TestBed.inject(ThemeStore).current()).toBe('industrial');
  });

  describe('browser chrome meta tags', () => {
    const meta = (name: string) =>
      document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;

    it('declares a dark color-scheme only for Grafito', () => {
      const store = TestBed.inject(ThemeStore);
      store.set('grafito');
      expect(meta('color-scheme')).toBe('dark');
      store.set('cereza');
      expect(meta('color-scheme')).toBe('light');
    });

    it('updates theme-color to the palette background on every change', () => {
      const store = TestBed.inject(ThemeStore);
      for (const { id } of THEMES) {
        store.set(id);
        expect(meta('theme-color')).toBe(THEME_CHROME[id].color);
      }
    });

    it('reuses the existing meta tags instead of adding new ones', () => {
      const store = TestBed.inject(ThemeStore);
      store.set('matcha');
      store.set('corporativo');
      expect(document.head.querySelectorAll('meta[name="theme-color"]').length).toBe(1);
      expect(document.head.querySelectorAll('meta[name="color-scheme"]').length).toBe(1);
    });
  });
});

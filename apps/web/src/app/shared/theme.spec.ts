import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY, ThemeStore } from './theme';

describe('ThemeStore', () => {
  const root = document.documentElement;

  afterEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    delete root.dataset['theme'];
  });

  it('starts with the Grafito palette (docs/paleta2.webp) when nothing was chosen', () => {
    const theme = TestBed.inject(ThemeStore);
    expect(theme.current()).toBe('grafito');
    expect(root.dataset['theme']).toBe('grafito');
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
    expect(TestBed.inject(ThemeStore).current()).toBe('grafito');
  });
});

import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY, ThemeStore } from './theme';

describe('ThemeStore', () => {
  const root = document.documentElement;

  afterEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    delete root.dataset['theme'];
  });

  it('starts with the classic palette and no data-theme', () => {
    const theme = TestBed.inject(ThemeStore);
    expect(theme.current()).toBe('clasico');
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
    expect(TestBed.inject(ThemeStore).current()).toBe('clasico');
  });
});

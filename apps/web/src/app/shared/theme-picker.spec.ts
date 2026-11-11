import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY } from './theme';
import { ThemePicker } from './theme-picker';

describe('ThemePicker', () => {
  afterEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    delete document.documentElement.dataset['theme'];
  });

  function render() {
    const fixture = TestBed.createComponent(ThemePicker);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const radio = (label: string) =>
      [...host.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
        (r) => r.closest('label')!.textContent!.trim() === label,
      )!;
    return { fixture, host, radio };
  }

  it('lists every palette as a labelled radio group with the current one checked', () => {
    const { host, radio } = render();
    expect(host.querySelector('fieldset legend')?.textContent?.trim()).toBe('Tema de colores');
    const labels = [...host.querySelectorAll('label')].map((l) => l.textContent!.trim());
    expect(labels).toEqual(['Clásico', 'Corporativo', 'Grafito', 'Industrial Neon']);
    expect(radio('Grafito').checked).toBe(true);
  });

  it('applies the chosen palette', () => {
    const { fixture, radio } = render();
    radio('Industrial Neon').click();
    fixture.detectChanges();
    expect(document.documentElement.dataset['theme']).toBe('industrial');
    expect(radio('Industrial Neon').checked).toBe(true);
  });

  it('previews each palette with its swatches, hidden from assistive tech', () => {
    const { host } = render();
    const swatches = host.querySelectorAll('label [aria-hidden="true"] span');
    expect(swatches.length).toBe(12); // 3 per palette
  });
});

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
    const select = host.querySelector<HTMLSelectElement>('select')!;
    const choose = (value: string) => {
      select.value = value;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    return { fixture, host, select, choose };
  }

  it('lists every palette in a select with a visible label, the current one selected', () => {
    const { host, select } = render();
    const label = host.querySelector('label[for="juntta-theme"]');
    expect(label?.textContent?.trim()).toBe('Tema de colores');
    expect(select.id).toBe('juntta-theme');
    const options = [...select.options].map((o) => o.textContent!.trim());
    expect(options).toEqual([
      'Clásico',
      'Corporativo',
      'Grafito',
      'Industrial Neon',
      'Matcha Organic',
      'Cereza',
    ]);
    expect(select.value).toBe('industrial');
  });

  it('applies and remembers the chosen palette', () => {
    const { choose } = render();
    choose('industrial');
    expect(document.documentElement.dataset['theme']).toBe('industrial');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('industrial');
  });

  it('previews the current palette with 3 swatches, hidden from assistive tech', () => {
    const { host, choose } = render();
    const swatches = () => host.querySelectorAll('[aria-hidden="true"] span');
    expect(swatches().length).toBe(3);
    expect((swatches()[1] as HTMLElement).style.background).toContain('198, 255, 61'); // Industrial Neon accent
    choose('matcha');
    expect((swatches()[1] as HTMLElement).style.background).toContain('255, 51, 85');
  });
});

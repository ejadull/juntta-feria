import { TestBed } from '@angular/core/testing';
import { Spinner } from './spinner';

describe('Spinner', () => {
  it('is a status region with a visually hidden label and a decorative ring', async () => {
    const fixture = TestBed.createComponent(Spinner);
    fixture.componentRef.setInput('label', 'Cargando predios…');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('role')).toBe('status');
    expect(host.querySelector('progress')?.getAttribute('aria-hidden')).toBe('true');
    const label = host.querySelector('span');
    expect(label?.textContent).toBe('Cargando predios…');
    expect(label?.classList.contains('sr-only')).toBe(true);
  });

  it('shows the label when asked to', async () => {
    const fixture = TestBed.createComponent(Spinner);
    fixture.componentRef.setInput('visibleLabel', true);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('span')?.className).not.toContain(
      'sr-only',
    );
  });
});

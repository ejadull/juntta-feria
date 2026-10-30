import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { InMemoryLayoutRepository } from './data/in-memory-layout.repository';
import { LayoutRepository } from './data/layout.repository';
import { LayoutEditorPage } from './layout-editor.page';

const RECT = { left: 0, top: 0, width: 1060, height: 660, right: 1060, bottom: 660, x: 0, y: 0 };

function pointer(type: string, x: number, y: number): Event {
  const init = { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1 };
  return typeof PointerEvent !== 'undefined'
    ? new PointerEvent(type, init)
    : new MouseEvent(type, init);
}

async function render(versionId: string) {
  TestBed.configureTestingModule({
    providers: [
      { provide: LayoutRepository, useValue: new InMemoryLayoutRepository() },
      provideRouter([{ path: 'organizador/layouts/:versionId/editor', children: [] }]),
    ],
  });
  const fixture = TestBed.createComponent(LayoutEditorPage);
  fixture.componentRef.setInput('versionId', versionId);
  await fixture.whenStable();
  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('LayoutEditorPage', () => {
  it('loads the version and renders its plan', async () => {
    const { host } = await render('demo-v1');
    expect(host.textContent).toContain('Versión 1 · Borrador · 100 × 60 m');
    expect(host.textContent).toContain('Sin errores');
    expect(host.querySelectorAll('app-floor-plan-canvas [data-id]')).toHaveLength(43);
  });

  it('shows an error for an unknown version', async () => {
    const { host } = await render('nope');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('nope');
  });

  it('wires canvas drags to the store (snapped, in meters)', async () => {
    const { fixture, host } = await render('demo-v1');
    const svg = host.querySelector('svg') as SVGSVGElement;
    svg.getBoundingClientRect = () => RECT as DOMRect;
    const a01 = () => host.querySelector('[data-id="demo-A01"] polygon')?.getAttribute('points');
    expect(a01()).toBe('5,10 8,10 8,13 5,13 5,10');

    // 10 px = 1 m, origin at (-3, -3) m: grab A01 at (6, 11) m and drag ~10 m to the right.
    host.querySelector('[data-id="demo-A01"]')!.dispatchEvent(pointer('pointerdown', 90, 140));
    svg.dispatchEvent(pointer('pointermove', 190.4, 140));
    svg.dispatchEvent(pointer('pointerup', 190.4, 140));
    await fixture.whenStable();

    expect(a01()).toBe('15,10 18,10 18,13 15,13 15,10');
    expect(host.querySelector('[data-id="demo-A01"]')?.classList).toContain('selected');
  });

  describe('panels and toolbar (LUI-07)', () => {
    const button = (host: HTMLElement, text: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
    const listItem = (host: HTMLElement, id: string) =>
      host.querySelector(`app-object-list [data-id="${id}"]`) as HTMLButtonElement;
    const selectedOnPlan = (host: HTMLElement) =>
      host.querySelector('app-floor-plan-canvas .shape.selected')?.getAttribute('data-id');

    it('selecting B03 in the list selects it on the plan (spec: "Lista sincronizada")', async () => {
      const { fixture, host } = await render('demo-v1');
      listItem(host, 'demo-B03').click();
      await fixture.whenStable();
      expect(selectedOnPlan(host)).toBe('demo-B03');
      expect(listItem(host, 'demo-B03').getAttribute('aria-current')).toBe('true');
    });

    it('edits through the properties panel and undoes from the toolbar', async () => {
      const { fixture, host } = await render('demo-v1');
      listItem(host, 'demo-A01').click();
      await fixture.whenStable();
      const width = host.querySelector('app-object-properties [name="w"]') as HTMLInputElement;
      width.value = '4';
      width.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      const a01 = () => host.querySelector('[data-id="demo-A01"] polygon')?.getAttribute('points');
      expect(a01()).toBe('5,10 9,10 9,13 5,13 5,10');

      button(host, 'Deshacer').click();
      await fixture.whenStable();
      expect(a01()).toBe('5,10 8,10 8,13 5,13 5,10');
    });

    it('adds a stand from the toolbar and selects it', async () => {
      const { fixture, host } = await render('demo-v1');
      button(host, 'Agregar').click();
      await fixture.whenStable();
      expect(host.querySelectorAll('app-floor-plan-canvas [data-kind="STAND"]')).toHaveLength(41);
      expect(selectedOnPlan(host)).toBeTruthy();
      expect(
        (host.querySelector('app-object-properties [name="kind"]') as HTMLSelectElement).value,
      ).toBe('STAND');
    });

    it('disables Publicar with errors, and clicking an error selects the object', async () => {
      const { fixture, host } = await render('demo-v1');
      expect(button(host, 'Publicar').disabled).toBe(false);

      listItem(host, 'demo-A01').click();
      await fixture.whenStable();
      const x = host.querySelector('app-object-properties [name="x"]') as HTMLInputElement;
      x.value = '7'; // A01 7..10 overlaps A02 (9..12)
      x.dispatchEvent(new Event('change'));
      await fixture.whenStable();

      expect(button(host, 'Publicar').disabled).toBe(true);
      host.querySelector<HTMLButtonElement>('app-validation-panel li button')!.click();
      await fixture.whenStable();
      expect(['demo-A01', 'demo-A02']).toContain(selectedOnPlan(host));
    });

    it('publishes into read-only, then "Crear nueva versión" opens an editable draft (AC-04)', async () => {
      const { fixture, host } = await render('demo-v1');
      button(host, 'Publicar').click();
      await fixture.whenStable();

      expect(host.textContent).toContain('Publicada');
      expect(host.querySelector('[role="status"].banner')?.textContent).toContain('solo lectura');
      expect(button(host, 'Publicar')).toBeUndefined();
      expect(host.querySelectorAll('app-floor-plan-canvas [data-handle]')).toHaveLength(0);

      button(host, 'Crear nueva versión').click();
      await fixture.whenStable();
      expect(host.textContent).toContain('Versión 2 · Borrador');
      expect(button(host, 'Publicar')).toBeDefined();
    });
  });

  describe('keyboard (LUI-08)', () => {
    const shape = (host: HTMLElement, id: string) =>
      host.querySelector(`app-floor-plan-canvas [data-id="${id}"]`) as SVGGElement;
    const points = (host: HTMLElement, id: string) =>
      shape(host, id)?.querySelector('polygon')?.getAttribute('points');
    const announced = (host: HTMLElement) =>
      host.querySelector('[data-announcer]')?.textContent?.trim() ?? '';
    const press = (key: string, mods: KeyboardEventInit = {}) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }),
      );

    async function focused(id: string) {
      const r = await render('demo-v1');
      const el = shape(r.host, id);
      el.focus();
      el.dispatchEvent(new FocusEvent('focus'));
      await r.fixture.whenStable();
      return r;
    }

    it('moves a focused stand one snap step per arrow and announces it (spec: "Mover con teclado")', async () => {
      const { fixture, host } = await focused('demo-A01');
      press('ArrowRight');
      press('ArrowRight');
      await fixture.whenStable();
      expect(points(host, 'demo-A01')).toBe('6,10 9,10 9,13 6,13 6,10'); // 2 × 0.5 m
      expect(announced(host)).toContain('A01 movido a 6, 10 m');
    });

    it('Shift+arrow moves 1 m and announces new validation errors', async () => {
      const { fixture, host } = await focused('demo-A01');
      press('ArrowRight', { shiftKey: true });
      press('ArrowRight', { shiftKey: true }); // 7..10 overlaps A02 (9..12)
      await fixture.whenStable();
      expect(points(host, 'demo-A01')).toBe('7,10 10,10 10,13 7,13 7,10');
      expect(announced(host)).toContain('1 error');
    });

    it('Alt+arrow resizes and R rotates', async () => {
      const { fixture, host } = await focused('demo-A01');
      press('ArrowRight', { altKey: true });
      await fixture.whenStable();
      expect(announced(host)).toContain('A01 redimensionado a 3.5 × 3 m');
      press('r');
      await fixture.whenStable();
      expect(announced(host)).toContain('A01 rotado');
    });

    it('Ctrl+D duplicates and focus follows the copy; Delete removes it; Ctrl+Z brings it back', async () => {
      const { fixture, host } = await focused('demo-A01');
      press('d', { ctrlKey: true });
      await fixture.whenStable();
      const copy = document.activeElement as SVGGElement;
      const copyId = copy.getAttribute('data-id')!;
      expect(copyId).not.toBe('demo-A01');
      expect(copy.classList).toContain('selected');
      expect(announced(host)).toMatch(/A01 duplicado como A\d+/);

      press('Delete');
      await fixture.whenStable();
      expect(shape(host, copyId)).toBeNull();
      expect(document.activeElement?.classList).toContain('plan');
      expect(announced(host)).toContain('borrado');

      press('z', { ctrlKey: true });
      await fixture.whenStable();
      expect(shape(host, copyId)).not.toBeNull();
      expect(announced(host)).toContain('Deshecho');
    });
  });

  it('flags invalid objects coming from validation', async () => {
    const { fixture, host } = await render('demo-v1');
    const svg = host.querySelector('svg') as SVGSVGElement;
    svg.getBoundingClientRect = () => RECT as DOMRect;

    // Drag A01 3 m right: x 8..11 overlaps A02 (9..12).
    host.querySelector('[data-id="demo-A01"]')!.dispatchEvent(pointer('pointerdown', 90, 140));
    svg.dispatchEvent(pointer('pointermove', 120, 140));
    svg.dispatchEvent(pointer('pointerup', 120, 140));
    await fixture.whenStable();

    expect(host.querySelector('[data-id="demo-A02"]')?.classList).toContain('invalid');
    expect(host.textContent).toContain('1 error');
  });
});

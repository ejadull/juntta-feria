import { TestBed } from '@angular/core/testing';
import type { ObjectPatch } from '../../domain/commands';
import { toPolygon } from '../../domain/geometry';
import type { LayoutObjectDto } from '../../domain/layout.types';
import { ObjectProperties } from './object-properties';

const A01: LayoutObjectDto = {
  id: 'a01',
  kind: 'STAND',
  code: 'A01',
  geometry: toPolygon({ x: 5, y: 10, w: 3, h: 4 }),
  metadata: {},
};
const FREE: LayoutObjectDto = {
  id: 'p',
  kind: 'OBSTACLE',
  code: null,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [4, 0],
        [5, 3],
        [2, 5],
        [0, 0],
      ],
    ],
  },
  metadata: {},
};

async function setup(object: LayoutObjectDto | null, readOnly = false) {
  const fixture = TestBed.createComponent(ObjectProperties);
  fixture.componentRef.setInput('object', object);
  fixture.componentRef.setInput('step', 0.5);
  fixture.componentRef.setInput('readOnly', readOnly);
  const patches: ObjectPatch[] = [];
  const actions: string[] = [];
  const c = fixture.componentInstance;
  c.patch.subscribe((p) => patches.push(p));
  c.rotate.subscribe(() => actions.push('rotate'));
  c.duplicate.subscribe(() => actions.push('duplicate'));
  c.remove.subscribe(() => actions.push('remove'));
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const field = (name: string) =>
    host.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement;
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  return { host, patches, actions, field, button };
}

function change(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('change'));
}

describe('ObjectProperties', () => {
  it('asks to select something when nothing is selected', async () => {
    const { host } = await setup(null);
    expect(host.textContent).toContain('Seleccioná un objeto');
    expect(host.querySelector('input')).toBeNull();
  });

  it('shows code, kind, width, length and position of the selected stand', async () => {
    const { host, field } = await setup(A01);
    expect(field('code').value).toBe('A01');
    expect(field('kind').value).toBe('STAND');
    expect(field('w').value).toBe('3');
    expect(field('h').value).toBe('4');
    expect(field('x').value).toBe('5');
    expect(field('y').value).toBe('10');
    for (const label of ['Código', 'Tipo', 'Ancho', 'Largo', 'X', 'Y'])
      expect(host.textContent).toContain(label);
    expect(field('w').getAttribute('step')).toBe('0.5');
  });

  it('shows no commercial data (spec: "Sin datos comerciales")', async () => {
    const text = (await setup(A01)).host.textContent!.toLowerCase();
    for (const word of ['precio', 'reserva', 'expositor', '$']) expect(text).not.toContain(word);
  });

  it('emits one patch per edited field and ignores non-numeric sizes', async () => {
    const { field, patches } = await setup(A01);
    change(field('code'), 'B07');
    change(field('kind'), 'AISLE');
    change(field('w'), '6');
    change(field('y'), '12.5');
    change(field('h'), '');
    expect(patches).toEqual([{ code: 'B07' }, { kind: 'AISLE' }, { w: 6 }, { y: 12.5 }]);
  });

  it('locks the geometry of free polygons but keeps code and kind editable', async () => {
    const { host, field } = await setup(FREE);
    for (const name of ['x', 'y', 'w', 'h']) expect(field(name).disabled).toBe(true);
    expect(field('code').disabled).toBe(false);
    expect(host.textContent).toContain('Forma libre');
  });

  it('emits rotate, duplicate and remove from its buttons', async () => {
    const { button, actions } = await setup(A01);
    button('Rotar')!.click();
    button('Duplicar')!.click();
    button('Borrar')!.click();
    expect(actions).toEqual(['rotate', 'duplicate', 'remove']);
  });

  it('is fully disabled and without actions in read-only mode', async () => {
    const { host, button } = await setup(A01, true);
    host
      .querySelectorAll('input, select')
      .forEach((el) => expect((el as HTMLInputElement).disabled).toBe(true));
    expect(button('Rotar')).toBeUndefined();
  });
});

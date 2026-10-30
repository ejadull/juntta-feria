import { TestBed } from '@angular/core/testing';
import { toPolygon } from '../../domain/geometry';
import type { LayoutObjectDto, LayoutObjectKind, Rect } from '../../domain/layout.types';
import { ObjectList } from './object-list';

const obj = (
  id: string,
  kind: LayoutObjectKind,
  code: string | null,
  rect: Rect,
): LayoutObjectDto => ({
  id,
  kind,
  code,
  geometry: toPolygon(rect),
  metadata: {},
});
const OBJECTS = [
  obj('a01', 'STAND', 'A01', { x: 0, y: 0, w: 3, h: 3 }),
  obj('b03', 'STAND', 'B03', { x: 0, y: 5, w: 3, h: 3 }),
  obj('aisle', 'AISLE', null, { x: 0, y: 10, w: 20, h: 4 }),
];

async function setup() {
  const fixture = TestBed.createComponent(ObjectList);
  fixture.componentRef.setInput('objects', OBJECTS);
  fixture.componentRef.setInput('selectedId', 'a01');
  fixture.componentRef.setInput('invalidIds', new Set(['b03']));
  const selected: string[] = [];
  fixture.componentInstance.select.subscribe((id) => selected.push(id));
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const items = () => [...host.querySelectorAll('li button')] as HTMLButtonElement[];
  return { fixture, host, items, selected };
}

describe('ObjectList', () => {
  it('lists every object by code or kind name, with the count', async () => {
    const { host, items } = await setup();
    const text = (b: HTMLElement) =>
      [...b.querySelectorAll('span')].map((s) => s.textContent!.trim()).join(' ');
    expect(items().map(text)).toEqual([
      'A01 Stand · 9 m²',
      '⚠ B03 Stand · 9 m²',
      'Pasillo Pasillo · 80 m²',
    ]);
    expect(host.textContent).toContain('3 de 3');
  });

  it('marks the selected item with aria-current and invalid ones with text, not only color', async () => {
    const { items } = await setup();
    expect(items()[0].getAttribute('aria-current')).toBe('true');
    expect(items()[1].getAttribute('aria-current')).toBeNull();
    expect(items()[1].getAttribute('aria-label')).toContain('con errores');
  });

  it('filters by code, case-insensitive', async () => {
    const { fixture, host, items } = await setup();
    const search = host.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'b0';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(items().map((b) => b.dataset['id'])).toEqual(['b03']);
    expect(host.textContent).toContain('1 de 3');
  });

  it('filters by kind', async () => {
    const { fixture, host, items } = await setup();
    const kind = host.querySelector('select') as HTMLSelectElement;
    kind.value = 'AISLE';
    kind.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(items().map((b) => b.dataset['id'])).toEqual(['aisle']);
  });

  it('emits the id of the clicked item', async () => {
    const { items, selected } = await setup();
    items()[1].click();
    expect(selected).toEqual(['b03']);
  });
});

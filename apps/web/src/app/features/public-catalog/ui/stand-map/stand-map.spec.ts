import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { toPolygon } from '../../../layout-editor/domain/geometry';
import type {
  MapFeature,
  PublicMapDto,
  PublicStandStatus,
} from '../../data/public-catalog.repository';
import { NO_FILTER, type StandFilter } from '../../domain/stand-filters';
import { StandMap } from './stand-map';

const stand = (code: string, x: number, sector: string, status: PublicStandStatus): MapFeature => ({
  type: 'Feature',
  geometry: toPolygon({ x, y: 2, w: 3, h: 3 }),
  properties: {
    kind: 'STAND',
    standId: `id-${code}`,
    code,
    areaM2: 9,
    status,
    sector,
    price: { currency: 'ARS', valueCents: 10_000_000 },
    exhibitor:
      status === 'OCCUPIED'
        ? { name: 'Lanas del Limay', category: 'Textil', description: null, photos: [], media: [] }
        : null,
  },
});

const MAP: PublicMapDto = {
  slug: 'demo',
  layoutVersion: 1,
  units: 'm',
  bounds: { width: 40, height: 20 },
  features: [
    stand('A01', 1, 'Diseño', 'AVAILABLE'),
    stand('A02', 5, 'Diseño', 'OCCUPIED'),
    stand('B01', 12, 'Regional', 'RESERVED'),
    stand('B02', 16, 'Regional', 'BLOCKED'),
    {
      type: 'Feature',
      geometry: toPolygon({ x: 0, y: 8, w: 40, h: 3 }),
      properties: { kind: 'AISLE', label: 'Pasillo' },
    },
  ],
};

async function setup(filter: StandFilter = NO_FILTER) {
  const fixture: ComponentFixture<StandMap> = TestBed.createComponent(StandMap);
  fixture.componentRef.setInput('map', MAP);
  fixture.componentRef.setInput('filter', filter);
  const selected: string[] = [];
  fixture.componentInstance.select.subscribe((id) => selected.push(id));
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const standEl = (code: string) => host.querySelector(`[data-code="${code}"]`) as SVGGElement;
  return { fixture, host, standEl, selected };
}

describe('StandMap (PUB-UI-03)', () => {
  it('renders every stand as an accessible button with code, sector, area, status and price', async () => {
    const { host, standEl } = await setup();
    expect(host.querySelectorAll('g.stand')).toHaveLength(4);
    const a01 = standEl('A01');
    expect(a01.getAttribute('role')).toBe('button');
    expect(a01.getAttribute('tabindex')).toBe('0');
    expect(a01.getAttribute('aria-label')?.replace(/\s/g, ' ')).toBe(
      'Stand A01, Diseño, 9 m², Disponible, $ 100.000',
    );
  });

  it('shows status with more than color: dashed reserved, striped occupied, hatched and locked blocked', async () => {
    const { standEl } = await setup();
    expect(standEl('B01').classList).toContain('status-reserved');
    expect(standEl('A02').querySelector('.strip')).not.toBeNull();
    const blocked = standEl('B02');
    expect(blocked.classList).toContain('status-blocked');
    expect(blocked.querySelector('.hatch')).not.toBeNull();
    expect(blocked.textContent).toContain('🔒');
    expect(blocked.getAttribute('aria-label')).toContain('Bloqueado');
  });

  it('labels the occupied stand with its public exhibitor', async () => {
    const { standEl } = await setup();
    expect(standEl('A02').getAttribute('aria-label')).toContain('Lanas del Limay');
  });

  it('draws derived sector outlines with their names (ADR 0002)', async () => {
    const { host } = await setup();
    const labels = [...host.querySelectorAll('.sector-label')].map((t) => t.textContent?.trim());
    expect(labels).toEqual(['Diseño', 'Regional']);
    expect(host.querySelectorAll('rect.sector')).toHaveLength(2);
  });

  it('counts per status in the chips and filters by status (dims, does not hide)', async () => {
    const { fixture, host, standEl } = await setup();
    const chip = (text: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('.legend button')].find((b) =>
        b.textContent?.includes(text),
      )!;
    expect(chip('Todos').textContent?.replace(/\s+/g, ' ')).toContain('Todos 4');
    expect(chip('Disponible').textContent?.replace(/\s+/g, ' ')).toContain('Disponible 1');

    chip('Disponible').click();
    await fixture.whenStable();
    expect(chip('Disponible').getAttribute('aria-pressed')).toBe('true');
    expect(standEl('A01').classList).not.toContain('dimmed');
    expect(standEl('A02').classList).toContain('dimmed');
    expect(host.querySelectorAll('g.stand')).toHaveLength(4);
  });

  it('dims stands outside the feriante filter', async () => {
    const { standEl } = await setup({ ...NO_FILTER, sector: 'Regional' });
    expect(standEl('A01').classList).toContain('dimmed');
    expect(standEl('B01').classList).not.toContain('dimmed');
  });

  it('selects with click, Enter and Space', async () => {
    const { standEl, selected } = await setup();
    standEl('A01').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    standEl('B01').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    standEl('B02').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(selected).toEqual(['id-A01', 'id-B01', 'id-B02']);
  });

  it('marks the selected stand and zooms with the buttons', async () => {
    const { fixture, host, standEl } = await setup();
    fixture.componentRef.setInput('selectedId', 'id-A01');
    await fixture.whenStable();
    expect(standEl('A01').classList).toContain('selected');
    expect(standEl('A01').getAttribute('aria-pressed')).toBe('true');

    const before = host.querySelector('svg')!.getAttribute('viewBox');
    (host.querySelector('[aria-label="Acercar"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.querySelector('svg')!.getAttribute('viewBox')).not.toBe(before);
  });
});

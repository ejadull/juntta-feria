import { TestBed } from '@angular/core/testing';
import { throwError } from 'rxjs';
import { httpError } from '../../../shared/http-error';
import { InMemoryLayoutRepository } from '../../layout-editor/data/in-memory-layout.repository';
import { LayoutRepository } from '../../layout-editor/data/layout.repository';
import { toPolygon } from '../../layout-editor/domain/geometry';
import type { LayoutVersionDto } from '../../layout-editor/domain/layout.types';
import {
  EventInventoryRepository,
  type SectorDto,
  type StandDto,
} from '../data/event-inventory.repository';
import { InMemoryEventInventoryRepository } from '../data/in-memory-event-inventory.repository';
import { StandsPanel } from './stands-panel';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const stand = (n: number, patch: Partial<StandDto> = {}): StandDto => ({
  id: `st${n}`,
  layoutObjectId: `o${n}`,
  code: `S${n}`,
  sectorId: null,
  status: 'AVAILABLE',
  priceCents: 0,
  hasPrice: false,
  currency: 'ARS',
  ...patch,
});
const SECTORS: SectorDto[] = [{ id: 'sec1', name: 'Gastronomía', sortOrder: 0 }];
const LAYOUT: LayoutVersionDto = {
  id: 'lv1',
  templateId: 't1',
  version: 1,
  status: 'PUBLISHED',
  widthM: 40,
  heightM: 20,
  objects: [1, 2, 3].map((n) => ({
    id: `o${n}`,
    kind: 'STAND' as const,
    code: `S${n}`,
    geometry: toPolygon({ x: n * 5, y: 0, w: 3, h: 4 }),
    metadata: {},
  })),
};

async function render(repo: EventInventoryRepository, layouts?: LayoutRepository) {
  TestBed.configureTestingModule({
    providers: [
      { provide: EventInventoryRepository, useValue: repo },
      ...(layouts ? [{ provide: LayoutRepository, useValue: layouts }] : []),
    ],
  });
  const fixture = TestBed.createComponent(StandsPanel);
  fixture.componentRef.setInput('eventId', 'e1');
  fixture.componentRef.setInput('layoutVersionId', 'lv1');
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const row = (code: string) => host.querySelector<HTMLElement>(`[data-stand="${code}"]`) ?? host;
  const price = async (code: string, value: string) => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="Precio de ${code}"]`);
    if (!input) throw new Error(`no price input for ${code}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const choose = async (label: string, value: string) => {
    const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    if (!select) throw new Error(`no select ${label}`);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  const click = async (label: string) => {
    const button = [...host.querySelectorAll('button')].find((b) =>
      plain(b.textContent).includes(label),
    );
    if (!button) throw new Error(`no button ${label}`);
    button.click();
    await fixture.whenStable();
  };
  return { host, row, price, choose, click };
}

describe('StandsPanel (EVT-01, P09)', () => {
  it('lists code, area from the plan, sector, status and price', async () => {
    const repo = new InMemoryEventInventoryRepository(
      [stand(1, { priceCents: 150_050, hasPrice: true, sectorId: 'sec1' }), stand(2)],
      SECTORS,
    );
    const { row } = await render(repo, new InMemoryLayoutRepository([LAYOUT]));
    const first = row('S1');
    expect(plain(first.querySelector('th')?.textContent)).toBe('S1');
    expect(plain(first.querySelectorAll('td')[0].textContent)).toBe('12');
    expect(first.querySelector<HTMLSelectElement>('select[aria-label="Sector de S1"]')?.value).toBe(
      'sec1',
    );
    expect(first.querySelector<HTMLInputElement>('input')?.value).toBe('1500,5');
    expect(row('S2').querySelector<HTMLInputElement>('input')?.value).toBe('');
  });

  it('shows an em dash for the area when the plan cannot be read', async () => {
    const layouts = new InMemoryLayoutRepository([LAYOUT]);
    layouts.get = () => throwError(() => new Error('offline'));
    const { row } = await render(new InMemoryEventInventoryRepository([stand(1)]), layouts);
    expect(plain(row('S1').querySelectorAll('td')[0].textContent)).toBe('—');
  });

  it('counts the stands that still need a price', async () => {
    const repo = new InMemoryEventInventoryRepository([
      stand(1),
      stand(2, { hasPrice: true, priceCents: 100 }),
      stand(3, { status: 'DISABLED' }),
    ]);
    const { host } = await render(repo);
    expect(plain(host.querySelector('[data-testid="unpriced-count"]')?.textContent)).toBe(
      '1 sin precio de 3 stands',
    );
  });

  it('saves prices as cents, sharing one request between stands with the same change', async () => {
    const repo = new InMemoryEventInventoryRepository([stand(1), stand(2), stand(3)]);
    const { price, click, host } = await render(repo);
    await price('S1', '1.500');
    await price('S2', '1500');
    await price('S3', '2000,50');
    expect(plain(host.querySelector('[data-testid="pending-count"]')?.textContent)).toContain(
      '3 stands con cambios',
    );
    await click('Guardar cambios');
    expect(repo.updates).toEqual([
      { priceCents: 150_000, standIds: ['st1', 'st2'] },
      { priceCents: 200_050, standIds: ['st3'] },
    ]);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Guardamos 3 stands');
    expect(plain(host.querySelector('[data-testid="pending-count"]')?.textContent)).toBe(
      'Sin cambios para guardar.',
    );
    expect(plain(host.querySelector('[data-testid="unpriced-count"]')?.textContent)).toContain(
      '0 sin precio',
    );
  });

  it('saves a sector and a status change', async () => {
    const repo = new InMemoryEventInventoryRepository(
      [stand(1, { hasPrice: true, priceCents: 100 })],
      SECTORS,
    );
    const { choose, click } = await render(repo);
    await choose('Sector de S1', 'sec1');
    await choose('Estado de S1', 'BLOCKED');
    await click('Guardar cambios');
    expect(repo.updates).toEqual([{ sectorId: 'sec1', status: 'BLOCKED', standIds: ['st1'] }]);
  });

  it('disables saving while nothing changed', async () => {
    const { host } = await render(new InMemoryEventInventoryRepository([stand(1)]));
    const save = [...host.querySelectorAll('button')].find((b) =>
      plain(b.textContent).includes('Guardar cambios'),
    );
    expect(save?.disabled).toBe(true);
  });

  it('flags an unreadable price on its row, sends nothing and focuses it', async () => {
    const repo = new InMemoryEventInventoryRepository([stand(1), stand(2)]);
    const { price, click, host, row } = await render(repo);
    await price('S1', 'caro');
    await price('S2', '1000');
    await click('Guardar cambios');
    expect(repo.updates).toEqual([]);
    const input = row('S1').querySelector('input');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(row('S1').textContent).toContain('Ingresá un precio en pesos');
    expect(row('S2').querySelector('[aria-invalid="true"]')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('does not let a price that had a value be emptied', async () => {
    const repo = new InMemoryEventInventoryRepository([
      stand(1, { hasPrice: true, priceCents: 100 }),
    ]);
    const { price, click, row } = await render(repo);
    await price('S1', '');
    await click('Guardar cambios');
    expect(row('S1').textContent).toContain('no puede quedar vacío');
    expect(repo.updates).toEqual([]);
  });

  it('keeps what was saved and reports the rows whose request failed', async () => {
    const repo = new InMemoryEventInventoryRepository([stand(1), stand(2)]);
    const update = repo.updateStands.bind(repo);
    repo.updateStands = (eventId, change) =>
      change.standIds.includes('st2') ? throwError(() => httpError(400)) : update(eventId, change);
    const { price, click, host, row } = await render(repo);
    await price('S1', '1000');
    await price('S2', '2000');
    await click('Guardar cambios');
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      'No pudimos guardar 1 stand',
    );
    expect(row('S2').textContent).toContain('ya no existe en este evento');
    expect(row('S1').querySelector('[aria-invalid="true"]')).toBeNull();
    expect(plain(host.querySelector('[data-testid="pending-count"]')?.textContent)).toContain(
      '1 stand con cambios',
    );
  });

  it('shows an assigned stand as read-only status', async () => {
    const { row } = await render(
      new InMemoryEventInventoryRepository([stand(1, { status: 'ASSIGNED', hasPrice: true })]),
    );
    expect(row('S1').textContent).toContain('Asignado');
    expect(row('S1').querySelector('select[aria-label="Estado de S1"]')).toBeNull();
  });

  it('fills the price of every stand without one, but not the disabled ones', async () => {
    const repo = new InMemoryEventInventoryRepository([
      stand(1),
      stand(2, { hasPrice: true, priceCents: 500_000 }),
      stand(3, { status: 'DISABLED' }),
    ]);
    const { host, click, row } = await render(repo);
    const bulk = host.querySelector<HTMLInputElement>('input[placeholder^="Ej."]');
    if (!bulk) throw new Error('no bulk input');
    bulk.value = '120000';
    bulk.dispatchEvent(new Event('input'));
    await click('Aplicar');
    expect(row('S1').querySelector('input')?.value).toBe('120000');
    expect(row('S2').querySelector('input')?.value).toBe('5000');
    expect(row('S3').querySelector('input')?.value).toBe('');
    await click('Guardar cambios');
    expect(repo.updates).toEqual([{ priceCents: 12_000_000, standIds: ['st1'] }]);
  });

  it('rejects an unreadable bulk price', async () => {
    const { host, click } = await render(new InMemoryEventInventoryRepository([stand(1)]));
    await click('Aplicar');
    expect(host.textContent).toContain('Ingresá un precio en pesos');
  });

  it('explains when the plan has no stands', async () => {
    const { host } = await render(new InMemoryEventInventoryRepository());
    expect(host.querySelector('[data-testid="no-stands"]')).not.toBeNull();
  });

  it('says so when the stands cannot load', async () => {
    const repo = new InMemoryEventInventoryRepository();
    repo.listStands = () => throwError(() => httpError(500));
    const { host } = await render(repo);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'No pudimos cargar los stands',
    );
  });
});

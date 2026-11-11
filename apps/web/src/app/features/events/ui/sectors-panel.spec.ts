import { TestBed } from '@angular/core/testing';
import { throwError } from 'rxjs';
import { InMemoryEventInventoryRepository } from '../data/in-memory-event-inventory.repository';
import {
  EventInventoryRepository,
  type SectorDto,
  type StandDto,
} from '../data/event-inventory.repository';
import { SectorsPanel } from './sectors-panel';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const SECTORS: SectorDto[] = [
  { id: 'sec1', name: 'Gastronomía', sortOrder: 0 },
  { id: 'sec2', name: 'Diseño', sortOrder: 1 },
];
const STAND: StandDto = {
  id: 'st1',
  layoutObjectId: 'o1',
  code: 'S1',
  sectorId: 'sec1',
  status: 'AVAILABLE',
  priceCents: 100,
  hasPrice: true,
  currency: 'ARS',
};

async function render(repo: EventInventoryRepository = new InMemoryEventInventoryRepository()) {
  TestBed.configureTestingModule({
    providers: [{ provide: EventInventoryRepository, useValue: repo }],
  });
  const fixture = TestBed.createComponent(SectorsPanel);
  fixture.componentRef.setInput('eventId', 'e1');
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const click = async (label: string) => {
    const target = [...host.querySelectorAll('button')].find(
      (b) => plain(b.textContent).includes(label) || b.getAttribute('aria-label') === label,
    );
    target?.click();
    await fixture.whenStable();
  };
  const type = async (label: string, value: string) => {
    const input = [...host.querySelectorAll('input')].find(
      (i) =>
        i.getAttribute('aria-label') === label ||
        plain(i.closest('label')?.querySelector('span')?.textContent) === label,
    );
    if (!input) throw new Error(`no input ${label}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const rows = () =>
    [...host.querySelectorAll('[data-testid="sector-row"]')].map((r) => plain(r.textContent));
  return { host, click, type, rows };
}

describe('SectorsPanel (EVT-01, ADR 0002)', () => {
  it('explains the empty state', async () => {
    const { host } = await render();
    expect(host.querySelector('[data-testid="no-sectors"]')?.textContent).toContain(
      'Todavía no hay sectores',
    );
  });

  it('lists the sectors with their order', async () => {
    const { rows } = await render(new InMemoryEventInventoryRepository([], SECTORS));
    expect(rows()[0]).toContain('Gastronomía');
    expect(rows()[0]).toContain('Orden 0');
    expect(rows()).toHaveLength(2);
  });

  it('adds a sector with its order', async () => {
    const repo = new InMemoryEventInventoryRepository();
    const create = vi.spyOn(repo, 'createSector');
    const { type, click, rows } = await render(repo);
    await type('Nombre del sector', 'Gastronomía');
    await type('Orden', '3');
    await click('Agregar sector');
    expect(create).toHaveBeenCalledWith('e1', { name: 'Gastronomía', sortOrder: 3 });
    expect(rows()).toHaveLength(1);
  });

  it('omits the order when it is left empty', async () => {
    const repo = new InMemoryEventInventoryRepository();
    const create = vi.spyOn(repo, 'createSector');
    const { type, click } = await render(repo);
    await type('Nombre del sector', 'Moda');
    await click('Agregar sector');
    expect(create).toHaveBeenCalledWith('e1', { name: 'Moda' });
  });

  it('validates the name and the order before calling the API', async () => {
    const repo = new InMemoryEventInventoryRepository();
    const create = vi.spyOn(repo, 'createSector');
    const { type, click, host } = await render(repo);
    await type('Orden', 'abc');
    await click('Agregar sector');
    expect(create).not.toHaveBeenCalled();
    expect(host.querySelectorAll('[aria-invalid="true"]')).toHaveLength(2);
    expect(host.textContent).toContain('Ingresá el nombre del sector');
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(host.querySelector('[aria-invalid="true"]')),
    );
  });

  it('says so when the name already exists in the event', async () => {
    const { type, click, host } = await render(new InMemoryEventInventoryRepository([], SECTORS));
    await type('Nombre del sector', 'gastronomía');
    await click('Agregar sector');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Ya hay un sector');
  });

  it('renames a sector inline', async () => {
    const repo = new InMemoryEventInventoryRepository([], SECTORS);
    const update = vi.spyOn(repo, 'updateSector');
    const { type, click, rows } = await render(repo);
    await click('Editar sector Diseño');
    await type('Nuevo nombre del sector', 'Diseño y moda');
    await click('Guardar');
    expect(update).toHaveBeenCalledWith('e1', 'sec2', { name: 'Diseño y moda', sortOrder: 1 });
    expect(rows()[1]).toContain('Diseño y moda');
  });

  it('does not touch the add form while a row is edited', async () => {
    const { type, click, host } = await render(new InMemoryEventInventoryRepository([], SECTORS));
    await type('Nombre del sector', 'Borrador');
    await click('Editar sector Diseño');
    const add = host.querySelector<HTMLInputElement>('form input');
    expect(add?.value).toBe('Borrador');
  });

  it('deletes after an in-page confirmation and says what happens to its stands', async () => {
    const repo = new InMemoryEventInventoryRepository([STAND], SECTORS);
    const { click, host, rows } = await render(repo);
    await click('Eliminar sector Gastronomía');
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('quedan sin sector');
    await click('Sí, eliminar');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it('keeps the sector when the confirmation is cancelled', async () => {
    const { click, host, rows } = await render(new InMemoryEventInventoryRepository([], SECTORS));
    await click('Eliminar sector Gastronomía');
    await click('Cancelar');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(rows()).toHaveLength(2);
  });

  it('says so when the sectors cannot load', async () => {
    const repo = new InMemoryEventInventoryRepository();
    repo.listSectors = () => throwError(() => ({ status: 500 }));
    const { host } = await render(repo);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'No pudimos cargar los sectores',
    );
  });
});

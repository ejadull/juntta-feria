import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { throwError } from 'rxjs';
import { signedInAs } from '../../shared/auth/testing';
import type { MembershipRole } from '../../shared/auth/session.store';
import { InMemoryVenueRepository } from './data/in-memory-venue.repository';
import { VenueRepository, type VenueDto } from './data/venue.repository';
import { VenuesPage } from './venues.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const venue = (patch: Partial<VenueDto> = {}): VenueDto => ({
  id: 'v1',
  type: 'FIXED',
  name: 'Espacio Duam',
  address: 'Av. Olascoaga 100',
  timezone: 'America/Argentina/Buenos_Aires',
  widthM: 40,
  heightM: 25.5,
  ...patch,
});

async function render(
  repo: VenueRepository = new InMemoryVenueRepository(),
  role: MembershipRole = 'OWNER',
  url = '/',
) {
  TestBed.configureTestingModule({
    providers: [
      { provide: VenueRepository, useValue: repo },
      signedInAs(role),
      provideRouter([{ path: '**', component: VenuesPage }]),
    ],
  });
  if (url !== '/') await TestBed.inject(Router).navigateByUrl(url);
  const fixture = TestBed.createComponent(VenuesPage);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find(
      (b) => plain(b.textContent).includes(label) || b.getAttribute('aria-label') === label,
    )!;
  const click = async (label: string) => {
    button(label).click();
    await fixture.whenStable();
  };
  const fill = async (label: string, value: string) => {
    const field = [...host.querySelectorAll('label')]
      .find((l) => plain(l.querySelector('span')?.textContent).startsWith(label))!
      .querySelector('input')!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const rows = () =>
    [...host.querySelectorAll('[data-testid="venue-row"]')].map((r) => plain(r.textContent));
  return { host, click, fill, rows };
}

async function fillValid(fill: (l: string, v: string) => Promise<void>, name = 'Predio Nuevo') {
  await fill('Nombre', name);
  await fill('Ancho', '30');
  await fill('Largo', '20,5');
}

describe('VenuesPage (VEN-01, organizador)', () => {
  it('explains the empty state and offers to create one', async () => {
    const { host } = await render();
    expect(host.querySelector('[data-testid="no-venues"]')?.textContent).toContain(
      'Todavía no hay predios',
    );
    expect(plain(host.querySelector('h1')?.textContent)).toBe('Predios');
  });

  it('lists venues with type, address and size', async () => {
    const { rows } = await render(new InMemoryVenueRepository([venue()]));
    expect(rows()[0]).toContain('Espacio Duam');
    expect(rows()[0]).toContain('Fijo');
    expect(rows()[0]).toContain('Av. Olascoaga 100');
    expect(rows()[0]).toContain('40 × 25,5 m');
  });

  it('creates a venue and shows it in the list', async () => {
    const repo = new InMemoryVenueRepository();
    const create = vi.spyOn(repo, 'create');
    const { click, fill, rows, host } = await render(repo);
    await click('Nuevo predio');
    await fillValid(fill);
    await click('Crear predio');
    expect(create).toHaveBeenCalledWith({
      type: 'FIXED',
      name: 'Predio Nuevo',
      address: null,
      timezone: 'America/Argentina/Buenos_Aires',
      widthM: 30,
      heightM: 20.5,
    });
    expect(rows()).toHaveLength(1);
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Creamos el predio');
  });

  it('opens the form from ?nuevo (the empty states link there)', async () => {
    const { host } = await render(new InMemoryVenueRepository(), 'OWNER', '/?nuevo=1');
    expect(host.querySelector('form')).not.toBeNull();
  });

  it('validates before calling the API and flags the invalid fields', async () => {
    const repo = new InMemoryVenueRepository();
    const create = vi.spyOn(repo, 'create');
    const { click, host, fill } = await render(repo);
    await click('Nuevo predio');
    await fill('Ancho', '0');
    await click('Crear predio');
    expect(create).not.toHaveBeenCalled();
    const invalid = [...host.querySelectorAll('[aria-invalid="true"]')].map((e) =>
      plain(e.closest('label')?.querySelector('span')?.textContent),
    );
    expect(invalid).toEqual(['Nombre', 'Ancho (m)', 'Largo (m)']);
    expect(host.textContent).toContain('Ingresá el nombre del predio');
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(host.querySelector('[aria-invalid="true"]')),
    );
  });

  it('rejects a time zone that does not exist', async () => {
    const { click, fill, host } = await render();
    await click('Nuevo predio');
    await fillValid(fill);
    await fill('Zona horaria', 'Marte/Olympus');
    await click('Crear predio');
    expect(host.textContent).toContain('zona horaria válida');
  });

  it('says so when the name is already taken', async () => {
    const { click, fill, host } = await render(new InMemoryVenueRepository([venue()]));
    await click('Nuevo predio');
    await fillValid(fill, 'espacio duam');
    await click('Crear predio');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Ya tenés un predio');
    expect(host.querySelector('form')).not.toBeNull();
  });

  it('edits a venue starting from its current values', async () => {
    const repo = new InMemoryVenueRepository([venue()]);
    const update = vi.spyOn(repo, 'update');
    const { click, fill, rows } = await render(repo);
    await click('Editar Espacio Duam');
    await fill('Nombre', 'Duam Norte');
    await click('Guardar cambios');
    expect(update).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({ name: 'Duam Norte', widthM: 40, heightM: 25.5 }),
    );
    expect(rows()[0]).toContain('Duam Norte');
  });

  it('deletes after an in-page confirmation (owner)', async () => {
    const { click, host, rows } = await render(new InMemoryVenueRepository([venue()]));
    await click('Eliminar Espacio Duam');
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    await click('Sí, eliminar');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it('keeps the venue when the confirmation is cancelled', async () => {
    const { click, host, rows } = await render(new InMemoryVenueRepository([venue()]));
    await click('Eliminar Espacio Duam');
    await click('Cancelar');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it('explains why a venue in use is not deleted', async () => {
    const repo = new InMemoryVenueRepository([venue()], new Set(['v1']));
    const { click, host, rows } = await render(repo);
    await click('Eliminar Espacio Duam');
    await click('Sí, eliminar');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('hay planos o eventos');
    expect(rows()).toHaveLength(1);
  });

  it('hides delete for an operator and says who can do it', async () => {
    const { host } = await render(new InMemoryVenueRepository([venue()]), 'OPERATOR');
    expect(host.querySelector('button.btn-danger')).toBeNull();
    expect(host.querySelector('[data-testid="remove-limited"]')?.textContent).toContain(
      'propietarios y administradores',
    );
  });

  it('lets an admin delete', async () => {
    const { host } = await render(new InMemoryVenueRepository([venue()]), 'ADMIN');
    expect(host.querySelector('button.btn-danger')).not.toBeNull();
  });

  it('says so when the list cannot load', async () => {
    const repo = new InMemoryVenueRepository();
    repo.list = () => throwError(() => ({ status: 500 }));
    const { host } = await render(repo);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'No pudimos cargar los predios',
    );
  });
});

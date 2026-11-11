import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { throwError } from 'rxjs';
import { InMemoryVenueRepository } from '../venues/data/in-memory-venue.repository';
import { VenueRepository, type VenueDto } from '../venues/data/venue.repository';
import { InMemoryLayoutTemplatesRepository } from './data/in-memory-layout-templates.repository';
import {
  LayoutTemplatesRepository,
  type LayoutTemplateDto,
} from './data/layout-templates.repository';
import { LayoutEntryPage } from './layout-entry.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const VENUE: VenueDto = {
  id: 'v1',
  type: 'FIXED',
  name: 'Espacio Duam',
  address: null,
  timezone: 'America/Argentina/Buenos_Aires',
  widthM: 40,
  heightM: 25,
};
const TEMPLATE: LayoutTemplateDto = {
  id: 't1',
  name: 'Salón principal',
  venueId: 'v1',
  versions: [
    { id: 'lv1', version: 1, status: 'ARCHIVED', publishedAt: '2026-10-01T12:00:00Z' },
    { id: 'lv2', version: 2, status: 'PUBLISHED', publishedAt: '2026-10-20T12:00:00Z' },
    { id: 'lv3', version: 3, status: 'DRAFT', publishedAt: null },
  ],
};

async function render(
  venues: VenueRepository = new InMemoryVenueRepository([VENUE]),
  templates: LayoutTemplatesRepository = new InMemoryLayoutTemplatesRepository([TEMPLATE]),
  url = '/',
) {
  TestBed.configureTestingModule({
    providers: [
      { provide: VenueRepository, useValue: venues },
      { provide: LayoutTemplatesRepository, useValue: templates },
      provideRouter([
        { path: 'organizador/layouts/:versionId/editor', children: [] },
        { path: '**', children: [] },
      ]),
    ],
  });
  const router = TestBed.inject(Router);
  if (url !== '/') await router.navigateByUrl(url);
  const fixture = TestBed.createComponent(LayoutEntryPage);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const click = async (label: string) => {
    [...host.querySelectorAll('button')].find((b) => plain(b.textContent).includes(label))!.click();
    await fixture.whenStable();
  };
  const fill = async (value: string) => {
    const input = host.querySelector('input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const choose = async (value: string) => {
    const select = host.querySelector('select')!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  return { host, router, click, fill, choose };
}

describe('LayoutEntryPage (LAY-01, organizador)', () => {
  it('lists each plan with its venue and the status of every version', async () => {
    const { host } = await render();
    const row = plain(host.querySelector('[data-testid="template-row"]')?.textContent);
    expect(row).toContain('Salón principal');
    expect(row).toContain('Predio: Espacio Duam');
    expect(row).toContain('Abrir versión 1 · Archivada');
    expect(row).toContain('Abrir versión 2 · Publicada');
    expect(row).toContain('Abrir versión 3 · Borrador');
    expect(host.querySelector('a[href="/organizador/layouts/lv3/editor"]')).not.toBeNull();
  });

  it('asks for a venue first when there is none, linking to create one', async () => {
    const { host } = await render(
      new InMemoryVenueRepository(),
      new InMemoryLayoutTemplatesRepository(),
    );
    expect(host.querySelector('[data-testid="no-venues"]')?.textContent).toContain(
      'Primero necesitás un predio',
    );
    expect(host.querySelector('a[href="/organizador/predios?nuevo=1"]')).not.toBeNull();
    expect(plain(host.textContent)).not.toContain('Nuevo plano');
  });

  it('explains there are no plans yet when a venue exists', async () => {
    const { host } = await render(
      new InMemoryVenueRepository([VENUE]),
      new InMemoryLayoutTemplatesRepository(),
    );
    expect(host.querySelector('[data-testid="no-layout"]')?.textContent).toContain(
      'Todavía no hay planos',
    );
  });

  it('creates a plan on the chosen venue and opens its draft in the editor', async () => {
    const templates = new InMemoryLayoutTemplatesRepository();
    const create = vi.spyOn(templates, 'create');
    const { click, fill, choose, router } = await render(
      new InMemoryVenueRepository([VENUE, { ...VENUE, id: 'v2', name: 'Galpón 13' }]),
      templates,
    );
    await click('Nuevo plano');
    await fill('Salón norte');
    await choose('v2');
    await click('Crear y abrir el editor');
    expect(create).toHaveBeenCalledWith({ name: 'Salón norte', venueId: 'v2' });
    expect(router.url).toBe('/organizador/layouts/draft-1/editor');
  });

  it('preselects the only venue', async () => {
    const templates = new InMemoryLayoutTemplatesRepository();
    const create = vi.spyOn(templates, 'create');
    const { click, fill } = await render(new InMemoryVenueRepository([VENUE]), templates);
    await click('Nuevo plano');
    await fill('Salón norte');
    await click('Crear y abrir el editor');
    expect(create).toHaveBeenCalledWith({ name: 'Salón norte', venueId: 'v1' });
  });

  it('validates the name and the venue before calling the API', async () => {
    const templates = new InMemoryLayoutTemplatesRepository();
    const create = vi.spyOn(templates, 'create');
    const { click, host } = await render(
      new InMemoryVenueRepository([VENUE, { ...VENUE, id: 'v2', name: 'Galpón 13' }]),
      templates,
    );
    await click('Nuevo plano');
    await click('Crear y abrir el editor');
    expect(create).not.toHaveBeenCalled();
    expect(host.querySelectorAll('[aria-invalid="true"]')).toHaveLength(2);
    expect(host.textContent).toContain('Ingresá el nombre del plano');
    expect(host.textContent).toContain('Elegí el predio del plano');
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(host.querySelector('[aria-invalid="true"]')),
    );
  });

  it('says so when the name is already taken and stays on the form', async () => {
    const { click, fill, host, router } = await render();
    await click('Nuevo plano');
    await fill('salón principal');
    await click('Crear y abrir el editor');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Ya tenés un plano');
    expect(router.url).toBe('/');
  });

  it('opens the form from ?nuevo (the empty states link there)', async () => {
    const { host } = await render(undefined, undefined, '/?nuevo=1');
    expect(host.querySelector('form')).not.toBeNull();
  });

  it('shows an alert when the plans cannot be loaded', async () => {
    const templates = new InMemoryLayoutTemplatesRepository();
    templates.list = () => throwError(() => new Error('offline'));
    const { host } = await render(undefined, templates);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No pudimos cargar');
  });
});

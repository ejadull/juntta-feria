import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { throwError } from 'rxjs';
import { InMemoryLayoutTemplatesRepository } from '../layout-editor/data/in-memory-layout-templates.repository';
import {
  LayoutTemplatesRepository,
  type LayoutTemplateDto,
} from '../layout-editor/data/layout-templates.repository';
import { InMemoryVenueRepository } from '../venues/data/in-memory-venue.repository';
import { VenueRepository, type VenueDto } from '../venues/data/venue.repository';
import { EventAdminRepository, type EventDto } from './data/event-admin.repository';
import { InMemoryEventAdminRepository } from './data/in-memory-event-admin.repository';
import { EventsPage } from './events.page';

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
const PLAN: LayoutTemplateDto = {
  id: 't1',
  name: 'Salón principal',
  venueId: 'v1',
  versions: [
    { id: 'lv1', version: 1, status: 'ARCHIVED', publishedAt: '2026-09-01T12:00:00Z' },
    { id: 'lv2', version: 2, status: 'PUBLISHED', publishedAt: '2026-10-01T12:00:00Z' },
    { id: 'lv3', version: 3, status: 'DRAFT', publishedAt: null },
  ],
};
const EVENT: EventDto = {
  id: 'e1',
  venueId: 'v1',
  layoutVersionId: 'lv2',
  name: 'Feria de Primavera',
  slug: 'feria-de-primavera',
  startsAt: '2026-11-20T13:00:00Z',
  endsAt: '2026-11-22T23:00:00Z',
  salesOpenAt: '2026-10-01T03:00:00Z',
  salesCloseAt: '2026-11-19T03:00:00Z',
  status: 'DRAFT',
  publishedAt: null,
};

async function render(
  {
    events = new InMemoryEventAdminRepository(),
    venues = new InMemoryVenueRepository([VENUE]),
    templates = new InMemoryLayoutTemplatesRepository([PLAN]),
  }: {
    events?: EventAdminRepository;
    venues?: VenueRepository;
    templates?: LayoutTemplatesRepository;
  } = {},
  url = '/',
) {
  TestBed.configureTestingModule({
    providers: [
      { provide: EventAdminRepository, useValue: events },
      { provide: VenueRepository, useValue: venues },
      { provide: LayoutTemplatesRepository, useValue: templates },
      provideRouter([{ path: '**', children: [] }]),
    ],
  });
  const router = TestBed.inject(Router);
  if (url !== '/') await router.navigateByUrl(url);
  const fixture = TestBed.createComponent(EventsPage);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const click = async (label: string) => {
    const button = [...host.querySelectorAll('button')].find((b) =>
      plain(b.textContent).includes(label),
    );
    if (!button) throw new Error(`no button ${label}`);
    button.click();
    await fixture.whenStable();
  };
  const field = (label: string) => {
    const found = [...host.querySelectorAll('label')].find((l) =>
      plain(l.querySelector('span')?.textContent).startsWith(label),
    );
    if (!found) throw new Error(`no field ${label}`);
    return found.querySelector('input, select') as HTMLInputElement | HTMLSelectElement;
  };
  const type = async (label: string, value: string) => {
    const input = field(label);
    input.value = value;
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
    await fixture.whenStable();
  };
  const fillAll = async () => {
    await type('Nombre', 'Feria de Primavera');
    await type('Predio', 'v1');
    await type('Plano publicado', 'lv2');
    await type('Inicio del evento', '2026-11-20T10:00');
    await type('Fin del evento', '2026-11-22T20:00');
    await type('Apertura de ventas', '2026-10-01T00:00');
    await type('Cierre de ventas', '2026-11-19T00:00');
  };
  const rows = () =>
    [...host.querySelectorAll('[data-testid="event-row"]')].map((r) => plain(r.textContent));
  return { host, router, click, type, field, fillAll, rows };
}

describe('EventsPage (EVT-01, organizador)', () => {
  it('explains the empty state', async () => {
    const { host } = await render();
    expect(host.querySelector('[data-testid="no-events"]')?.textContent).toContain(
      'Todavía no hay eventos',
    );
  });

  it('lists events with dates, venue and a status in words', async () => {
    const { rows, host } = await render({
      events: new InMemoryEventAdminRepository([
        EVENT,
        { ...EVENT, id: 'e2', slug: 'otra', status: 'PUBLISHED' },
      ]),
    });
    expect(rows()[0]).toContain('Feria de Primavera');
    expect(rows()[0]).toContain('Espacio Duam');
    expect(rows()[0]).toContain('Borrador');
    expect(rows()[1]).toContain('Publicado');
    expect(host.querySelector('a[href="/organizador/eventos/e1"]')).not.toBeNull();
  });

  it('asks for a venue first when there is none', async () => {
    const { host, click } = await render({
      venues: new InMemoryVenueRepository(),
      templates: new InMemoryLayoutTemplatesRepository(),
    });
    await click('Nuevo evento');
    expect(host.querySelector('[data-testid="needs-plan"]')?.textContent).toContain(
      'un predio y un plano publicado',
    );
    expect(host.querySelector('a[href="/organizador/predios?nuevo=1"]')).not.toBeNull();
  });

  it('points to the plans when the venue has none published', async () => {
    const draftOnly: LayoutTemplateDto = {
      ...PLAN,
      versions: [{ id: 'lv9', version: 1, status: 'DRAFT', publishedAt: null }],
    };
    const { host, click } = await render({
      templates: new InMemoryLayoutTemplatesRepository([draftOnly]),
    });
    await click('Nuevo evento');
    expect(host.querySelector('a[href="/organizador/plano"]')).not.toBeNull();
    expect(host.querySelector('form')).toBeNull();
  });

  it('offers only the published versions of the chosen venue plans', async () => {
    const other: LayoutTemplateDto = { ...PLAN, id: 't2', name: 'Galpón', venueId: 'v2' };
    const { host, click, type, field } = await render({
      venues: new InMemoryVenueRepository([VENUE, { ...VENUE, id: 'v2', name: 'Galpón 13' }]),
      templates: new InMemoryLayoutTemplatesRepository([PLAN, other]),
    });
    await click('Nuevo evento');
    await type('Predio', 'v1');
    const options = [...(field('Plano publicado') as HTMLSelectElement).options].map((o) =>
      plain(o.textContent),
    );
    expect(options).toEqual(['Elegí un plano', 'Salón principal · versión 2']);
    expect(host.querySelector('form')).not.toBeNull();
  });

  it('offers the published version of every plan of the venue, not only the newest plan', async () => {
    const north: LayoutTemplateDto = {
      id: 't3',
      name: 'Salón norte',
      venueId: 'v1',
      versions: [
        { id: 'n1', version: 1, status: 'ARCHIVED', publishedAt: '2026-08-01T12:00:00Z' },
        { id: 'n2', version: 2, status: 'ARCHIVED', publishedAt: '2026-09-01T12:00:00Z' },
        { id: 'n3', version: 3, status: 'PUBLISHED', publishedAt: '2026-10-05T12:00:00Z' },
        { id: 'n4', version: 4, status: 'DRAFT', publishedAt: null },
      ],
    };
    const anyVenue: LayoutTemplateDto = { ...PLAN, id: 't4', name: 'Genérico', venueId: null };
    const { click, type, field } = await render({
      templates: new InMemoryLayoutTemplatesRepository([PLAN, north, anyVenue]),
    });
    await click('Nuevo evento');
    await type('Predio', 'v1');
    const options = [...(field('Plano publicado') as HTMLSelectElement).options].map((o) =>
      plain(o.textContent),
    );
    expect(options).toEqual([
      'Elegí un plano',
      'Salón principal · versión 2',
      'Salón norte · versión 3',
      'Genérico · versión 2',
    ]);
  });

  it('says that the event keeps the chosen version of the plan', async () => {
    const { host, click } = await render();
    await click('Nuevo evento');
    expect(plain(host.querySelector('#event-plan-hint')?.textContent)).toContain(
      'El evento conserva esa versión del plano',
    );
  });

  it('creates the event with ISO dates in Argentina time and opens its detail', async () => {
    const events = new InMemoryEventAdminRepository();
    const create = vi.spyOn(events, 'create');
    const { click, fillAll, router } = await render({ events });
    await click('Nuevo evento');
    await fillAll();
    await click('Crear evento');
    expect(create).toHaveBeenCalledWith({
      venueId: 'v1',
      layoutVersionId: 'lv2',
      name: 'Feria de Primavera',
      startsAt: '2026-11-20T10:00:00-03:00',
      endsAt: '2026-11-22T20:00:00-03:00',
      salesOpenAt: '2026-10-01T00:00:00-03:00',
      salesCloseAt: '2026-11-19T00:00:00-03:00',
    });
    expect(router.url).toBe('/organizador/eventos/event-1');
  });

  it('sends the slug only when one was typed', async () => {
    const events = new InMemoryEventAdminRepository();
    const create = vi.spyOn(events, 'create');
    const { click, fillAll, type } = await render({ events });
    await click('Nuevo evento');
    await fillAll();
    await type('Dirección web', 'primavera-2026');
    await click('Crear evento');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ slug: 'primavera-2026' }));
  });

  it('validates everything before calling the API and focuses the first problem', async () => {
    const events = new InMemoryEventAdminRepository();
    const create = vi.spyOn(events, 'create');
    const { click, host, type } = await render({
      events,
      venues: new InMemoryVenueRepository([VENUE, { ...VENUE, id: 'v2', name: 'Galpón 13' }]),
    });
    await click('Nuevo evento');
    await type('Dirección web', 'Con Espacios');
    await click('Crear evento');
    expect(create).not.toHaveBeenCalled();
    const messages = plain(host.querySelector('form')?.textContent);
    for (const expected of [
      'Ingresá el nombre del evento',
      'minúsculas, números y guiones',
      'Elegí el predio del evento',
      'Elegí un plano publicado',
      'fecha y hora válidas',
    ])
      expect(messages).toContain(expected);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(host.querySelector('[aria-invalid="true"]')),
    );
  });

  it('checks the dates against each other', async () => {
    const events = new InMemoryEventAdminRepository();
    const create = vi.spyOn(events, 'create');
    const { click, fillAll, type, host } = await render({ events });
    await click('Nuevo evento');
    await fillAll();
    await type('Cierre de ventas', '2026-11-23T00:00');
    await click('Crear evento');
    expect(create).not.toHaveBeenCalled();
    expect(host.textContent).toContain('no pueden cerrar después de que termina el evento');
  });

  // The in-memory repository derives the slug from the name, so the same name collides (409).
  it('says so when the web address is taken and stays on the form', async () => {
    const { click, fillAll, host, router } = await render({
      events: new InMemoryEventAdminRepository([EVENT]),
    });
    await click('Nuevo evento');
    await fillAll();
    await click('Crear evento');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Ya hay un evento');
    expect(router.url).toBe('/');
  });

  it('opens the form from ?nuevo (the empty states link there)', async () => {
    const { host } = await render({}, '/?nuevo=1');
    expect(host.querySelector('form')).not.toBeNull();
  });

  it('shows an alert when the events cannot be loaded', async () => {
    const events = new InMemoryEventAdminRepository();
    events.list = () => throwError(() => new Error('offline'));
    const { host } = await render({ events });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'No pudimos cargar tus eventos',
    );
  });
});

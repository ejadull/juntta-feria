import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import type { MembershipRole } from '../../shared/auth/session.store';
import { signedInAs } from '../../shared/auth/testing';
import { httpError } from '../../shared/http-error';
import { InMemoryVenueRepository } from '../venues/data/in-memory-venue.repository';
import { VenueRepository } from '../venues/data/venue.repository';
import { InMemoryLayoutTemplatesRepository } from '../layout-editor/data/in-memory-layout-templates.repository';
import {
  LayoutTemplatesRepository,
  type LayoutTemplateDto,
} from '../layout-editor/data/layout-templates.repository';
import {
  EventAdminRepository,
  EventPublishRejectedError,
  type EventDto,
} from './data/event-admin.repository';
import { EventInventoryRepository } from './data/event-inventory.repository';
import { InMemoryEventAdminRepository } from './data/in-memory-event-admin.repository';
import { InMemoryEventInventoryRepository } from './data/in-memory-event-inventory.repository';
import { EventDetailPage } from './event-detail.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const EVENT: EventDto = {
  id: 'e1',
  venueId: 'v1',
  layoutVersionId: 'lv2',
  name: 'Feria de Primavera',
  slug: 'feria-de-primavera',
  startsAt: '2026-11-20T13:00:00.000Z',
  endsAt: '2026-11-22T23:00:00.000Z',
  salesOpenAt: '2026-10-01T03:00:00.000Z',
  salesCloseAt: '2026-11-19T03:00:00.000Z',
  status: 'DRAFT',
  publishedAt: null,
};
const VENUES = new InMemoryVenueRepository([
  {
    id: 'v1',
    type: 'FIXED',
    name: 'Espacio Duam',
    address: null,
    timezone: 'America/Argentina/Buenos_Aires',
    widthM: 40,
    heightM: 25,
  },
]);

const PLAN: LayoutTemplateDto = {
  id: 't1',
  name: 'Salón principal',
  venueId: 'v1',
  versions: [
    { id: 'lv1', version: 1, status: 'ARCHIVED', publishedAt: '2026-09-01T12:00:00Z' },
    { id: 'lv2', version: 2, status: 'ARCHIVED', publishedAt: '2026-10-01T12:00:00Z' },
    { id: 'lv3', version: 3, status: 'PUBLISHED', publishedAt: '2026-10-20T12:00:00Z' },
  ],
};

async function render(
  events: EventAdminRepository = new InMemoryEventAdminRepository([EVENT]),
  role: MembershipRole = 'OWNER',
  templates: LayoutTemplatesRepository = new InMemoryLayoutTemplatesRepository([PLAN]),
) {
  TestBed.configureTestingModule({
    providers: [
      { provide: EventAdminRepository, useValue: events },
      { provide: VenueRepository, useValue: VENUES },
      { provide: LayoutTemplatesRepository, useValue: templates },
      { provide: EventInventoryRepository, useValue: new InMemoryEventInventoryRepository() },
      signedInAs(role),
      provideRouter([]),
    ],
  });
  const fixture = TestBed.createComponent(EventDetailPage);
  fixture.componentRef.setInput('id', 'e1');
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
  const type = async (label: string, value: string) => {
    const input = [...host.querySelectorAll('label')]
      .find((l) => plain(l.querySelector('span')?.textContent).startsWith(label))
      ?.querySelector('input');
    if (!input) throw new Error(`no field ${label}`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const tab = (label: string) =>
    [...host.querySelectorAll('[role="tab"]')].find((t) => plain(t.textContent) === label);
  const publishButton = () =>
    [...host.querySelectorAll('button')].find((b) => plain(b.textContent) === 'Publicar evento');
  return { host, click, type, tab, publishButton, fixture };
}

describe('EventDetailPage (EVT-01, organizador)', () => {
  it('shows the event, its venue and status, and the data form with the stored values', async () => {
    const { host } = await render();
    expect(plain(host.querySelector('h1')?.textContent)).toBe('Feria de Primavera');
    expect(plain(host.querySelector('header')?.textContent)).toContain('Espacio Duam');
    expect(plain(host.querySelector('header')?.textContent)).toContain('Borrador');
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')];
    expect(inputs.map((i) => i.value)).toEqual([
      '2026-11-20T10:00',
      '2026-11-22T20:00',
      '2026-10-01T00:00',
      '2026-11-19T00:00',
    ]);
  });

  it('shows which plan and version the event uses, and how to use another one', async () => {
    const { host } = await render();
    const plan = host.querySelector('[data-testid="event-plan"]');
    expect(plain(plan?.textContent)).toContain('Plano del evento: Salón principal · versión 2');
    expect(plain(plan?.textContent)).toContain('(archivada)');
    expect(plain(plan?.textContent)).toContain('Para usar otro plano, creá un evento nuevo.');
    expect(plan?.querySelector('a[href="/organizador/eventos?nuevo=1"]')).not.toBeNull();
    expect(plan?.querySelector('a[href="/organizador/layouts/lv2/editor"]')).not.toBeNull();
  });

  it('still loads when the plans cannot be read, naming no plan', async () => {
    const templates = new InMemoryLayoutTemplatesRepository([PLAN]);
    templates.list = () => throwError(() => new Error('offline'));
    const { host } = await render(undefined, 'OWNER', templates);
    const plan = host.querySelector('[data-testid="event-plan"]');
    expect(plain(plan?.textContent)).not.toContain('Salón principal');
    expect(plain(plan?.textContent)).toContain('Para usar otro plano, creá un evento nuevo.');
    expect(plain(host.querySelector('h1')?.textContent)).toBe('Feria de Primavera');
  });

  it('has three tabs, with the data one selected', async () => {
    const { host, tab } = await render();
    expect([...host.querySelectorAll('[role="tab"]')].map((t) => plain(t.textContent))).toEqual([
      'Datos',
      'Sectores',
      'Stands y precios',
    ]);
    expect(tab('Datos')?.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('[role="tabpanel"]')).not.toBeNull();
  });

  it('switches tabs by click and by arrow keys', async () => {
    const { host, click, tab, fixture } = await render();
    await click('Sectores');
    expect(host.querySelector('app-sectors-panel')).not.toBeNull();
    expect(tab('Sectores')?.getAttribute('tabindex')).toBe('0');
    expect(tab('Datos')?.getAttribute('tabindex')).toBe('-1');
    tab('Sectores')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await fixture.whenStable();
    expect(host.querySelector('app-stands-panel')).not.toBeNull();
    expect(tab('Stands y precios')?.getAttribute('aria-selected')).toBe('true');
  });

  it('saves only the fields that changed', async () => {
    const events = new InMemoryEventAdminRepository([EVENT]);
    const update = vi.spyOn(events, 'update');
    const { host, click, type } = await render(events);
    await type('Nombre', 'Feria de Primavera 2026');
    await type('Cierre de ventas', '2026-11-19T12:00');
    await click('Guardar cambios');
    expect(update).toHaveBeenCalledWith('e1', {
      name: 'Feria de Primavera 2026',
      salesCloseAt: '2026-11-19T12:00:00-03:00',
    });
    expect(plain(host.querySelector('h1')?.textContent)).toBe('Feria de Primavera 2026');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Guardamos los cambios');
  });

  it('does not call the API when nothing changed', async () => {
    const events = new InMemoryEventAdminRepository([EVENT]);
    const update = vi.spyOn(events, 'update');
    const { host, click } = await render(events);
    await click('Guardar cambios');
    expect(update).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('No hay cambios');
  });

  it('validates the dates before saving', async () => {
    const events = new InMemoryEventAdminRepository([EVENT]);
    const update = vi.spyOn(events, 'update');
    const { host, click, type } = await render(events);
    await type('Fin del evento', '2026-11-20T09:00');
    await click('Guardar cambios');
    expect(update).not.toHaveBeenCalled();
    expect(host.textContent).toContain('El fin tiene que ser posterior al inicio');
  });

  it('says so when the web address is taken', async () => {
    const events = new InMemoryEventAdminRepository([EVENT, { ...EVENT, id: 'e2', slug: 'otra' }]);
    const { host, click, type } = await render(events);
    await type('Dirección web', 'otra');
    await click('Guardar cambios');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('ya está en uso');
  });

  it('locks the data of a published event and shows when it was published', async () => {
    const published: EventDto = {
      ...EVENT,
      status: 'PUBLISHED',
      publishedAt: '2026-10-02T15:00:00.000Z',
    };
    const { host } = await render(new InMemoryEventAdminRepository([published]));
    expect(host.querySelector('[data-testid="data-locked"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="published-at"]')?.textContent).toContain(
      'Publicado el',
    );
    expect(host.querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
    expect(host.querySelector('#publish-title')).toBeNull();
  });

  it('publishes after an in-page confirmation', async () => {
    const events = new InMemoryEventAdminRepository([EVENT]);
    const publish = vi.spyOn(events, 'publish');
    const { host, click } = await render(events);
    await click('Publicar evento');
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(publish).not.toHaveBeenCalled();
    await click('Sí, publicar');
    expect(publish).toHaveBeenCalledWith('e1');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(plain(host.querySelector('header')?.textContent)).toContain('Publicado');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Publicamos el evento');
  });

  it('keeps the event as a draft when the confirmation is cancelled', async () => {
    const events = new InMemoryEventAdminRepository([EVENT]);
    const publish = vi.spyOn(events, 'publish');
    const { host, click } = await render(events);
    await click('Publicar evento');
    await click('Cancelar');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });

  it('shows the API issues, in Spanish, when publishing is rejected', async () => {
    const events = new InMemoryEventAdminRepository([EVENT], () => [
      { code: 'STAND_WITHOUT_PRICE', objectIds: ['a', 'b', 'c'], message: 'x' },
      { code: 'NO_SELLABLE_STANDS', objectIds: [], message: 'y' },
    ]);
    const { host, click } = await render(events);
    await click('Publicar evento');
    await click('Sí, publicar');
    const issues = plain(host.querySelector('[data-testid="publish-issues"]')?.textContent);
    expect(issues).toContain('Hay 3 stands sin precio');
    expect(issues).toContain('No hay ningún stand disponible');
    expect(plain(host.querySelector('header')?.textContent)).toContain('Borrador');
  });

  it('leads from the issues to the stands tab', async () => {
    const events = new InMemoryEventAdminRepository([EVENT], () => [
      { code: 'STAND_WITHOUT_PRICE', objectIds: ['a'], message: 'x' },
    ]);
    const { host, click } = await render(events);
    await click('Publicar evento');
    await click('Sí, publicar');
    expect(host.querySelector('[data-testid="publish-issues"]')?.textContent).toContain(
      'Hay 1 stand sin precio',
    );
    await click('Ir a Stands y precios');
    expect(host.querySelector('app-stands-panel')).not.toBeNull();
  });

  it('falls back to the API message for an issue it does not know', async () => {
    const events = new InMemoryEventAdminRepository([EVENT]);
    events.publish = () =>
      throwError(
        () =>
          new EventPublishRejectedError([
            { code: 'NEW_RULE', objectIds: [], message: 'Falta algo.' },
          ]),
      );
    const { host, click } = await render(events);
    await click('Publicar evento');
    await click('Sí, publicar');
    expect(host.querySelector('[data-testid="publish-issues"]')?.textContent).toContain(
      'Falta algo.',
    );
  });

  it('explains a publish that fails for another reason', async () => {
    const events = new InMemoryEventAdminRepository([EVENT]);
    events.publish = () => throwError(() => httpError(409));
    const { host, click } = await render(events);
    await click('Publicar evento');
    await click('Sí, publicar');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('ya no está en borrador');
  });

  it('lets an admin publish', async () => {
    const { publishButton } = await render(undefined, 'ADMIN');
    expect(publishButton()?.disabled).toBe(false);
  });

  it('disables publishing for an operator and says who can do it', async () => {
    const events = new InMemoryEventAdminRepository([EVENT]);
    const publish = vi.spyOn(events, 'publish');
    const { host, publishButton } = await render(events, 'OPERATOR');
    expect(publishButton()?.disabled).toBe(true);
    expect(publishButton()?.getAttribute('aria-describedby')).toBe('publish-limited');
    expect(host.querySelector('#publish-limited')?.textContent).toContain(
      'propietarios y administradores',
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it('says so when the event does not exist', async () => {
    const { host } = await render(new InMemoryEventAdminRepository());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'No encontramos este evento',
    );
  });

  it('says so when the event cannot be loaded', async () => {
    const events = new InMemoryEventAdminRepository();
    events.get = () => throwError(() => httpError(500));
    const { host } = await render(events);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'No pudimos cargar el evento',
    );
  });
});

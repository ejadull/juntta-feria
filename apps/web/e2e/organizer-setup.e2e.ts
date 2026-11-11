import { expect, test } from '@playwright/test';
import {
  EVENT,
  mockApi,
  seriousViolations,
  type ApiStand,
  type ApiTemplate,
  type ApiVenue,
} from './support/mock-api';

/** VEN-01, LAY-01, EVT-01 from the web: venue, plan, event, sectors, prices, publish. */

const VENUE: ApiVenue = {
  id: 'v1',
  type: 'FIXED',
  name: 'Predio Norte',
  address: null,
  timezone: 'America/Argentina/Buenos_Aires',
  widthM: 20,
  heightM: 8,
};

const stand = (n: number): ApiStand => ({
  id: `st${n}`,
  layoutObjectId: `o${n}`,
  code: `S${n}`,
  sectorId: null,
  status: 'AVAILABLE',
  priceCents: 0,
  hasPrice: false,
  currency: 'ARS',
});

test('staff sets everything up: venue, plan, event, sectors, prices and publish', async ({
  page,
}) => {
  const api = await mockApi(page, { role: 'OWNER', events: [] });

  // Predio
  await page.goto('/organizador/predios');
  await expect(page.getByText('Todavía no hay predios')).toBeVisible();
  await page.getByRole('button', { name: 'Nuevo predio' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Predio Norte');
  await page.getByLabel('Ancho (m)').fill('20');
  await page.getByLabel('Largo (m)').fill('8');
  await page.getByRole('button', { name: 'Crear predio' }).click();
  await expect(page.getByRole('row', { name: /Predio Norte/ })).toBeVisible();
  expect(api.requests.find((r) => r.method === 'POST' && r.path === '/venues')?.body).toMatchObject(
    { name: 'Predio Norte', type: 'FIXED', widthM: 20, heightM: 8 },
  );

  // Plano: a new plan opens its draft in the editor
  await page
    .getByRole('navigation', { name: 'Secciones del organizador' })
    .getByRole('link', { name: 'Editor de plano' })
    .click();
  await page.getByRole('button', { name: 'Nuevo plano' }).click();
  await page.getByLabel('Nombre del plano').fill('Salón norte');
  await page.getByRole('button', { name: 'Crear y abrir el editor' }).click();
  await expect(page).toHaveURL(/\/organizador\/layouts\/tpl1-v1\/editor$/);
  await expect(page.getByText('Versión 1 · Borrador')).toBeVisible();

  // The editor publishes (covered by layout-editor.e2e); here the plan is published directly.
  api.layouts['tpl1-v1'] = {
    ...api.layouts['tpl1-v1'],
    status: 'PUBLISHED',
    objects: structuredClone(api.layouts['lv1'].objects.slice(0, 2)),
  };
  api.templates[0].versions[0].status = 'PUBLISHED';

  // Evento
  await page
    .getByRole('navigation', { name: 'Secciones del organizador' })
    .getByRole('link', { name: 'Eventos' })
    .click();
  await expect(page.getByText('Todavía no hay eventos')).toBeVisible();
  await page.getByRole('button', { name: 'Nuevo evento' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Feria Norte');
  await page.getByLabel('Plano publicado').selectOption({ label: 'Salón norte · versión 1' });
  await page.getByLabel('Inicio del evento').fill('2026-11-20T10:00');
  await page.getByLabel('Fin del evento').fill('2026-11-22T20:00');
  await page.getByLabel('Apertura de ventas').fill('2026-10-01T00:00');
  await page.getByLabel('Cierre de ventas').fill('2026-11-19T00:00');
  await page.getByRole('button', { name: 'Crear evento' }).click();
  await expect(page).toHaveURL(/\/organizador\/eventos\/e-new-1$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Feria Norte');
  expect(api.requests.find((r) => r.method === 'POST' && r.path === '/events')?.body).toMatchObject(
    { venueId: 'v1', layoutVersionId: 'tpl1-v1', startsAt: '2026-11-20T10:00:00-03:00' },
  );

  // Sectores
  await page.getByRole('tab', { name: 'Sectores' }).click();
  await page.getByLabel('Nombre del sector', { exact: true }).fill('Gastronomía');
  await page.getByRole('button', { name: 'Agregar sector' }).click();
  await expect(page.getByTestId('sector-row')).toContainText('Gastronomía');

  // Publishing without prices is rejected and the API issues are shown
  await page.getByRole('button', { name: 'Publicar evento' }).click();
  await page.getByRole('button', { name: 'Sí, publicar' }).click();
  await expect(page.getByTestId('publish-issues')).toContainText('Hay 2 stands sin precio');
  expect(await seriousViolations(page)).toEqual([]);

  // Stands y precios
  await page.getByRole('button', { name: 'Ir a Stands y precios' }).click();
  await page.getByLabel('Precio de S1').fill('150.000');
  await page.getByLabel('Precio de S2').fill('150000');
  await page.getByLabel('Sector de S1').selectOption({ label: 'Gastronomía' });
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Guardamos 2 stands' })).toBeVisible();
  const patches = api.requests.filter(
    (r) => r.method === 'PATCH' && r.path === '/events/e-new-1/stands',
  );
  expect(patches.map((r) => r.body)).toEqual([
    { priceCents: 15_000_000, sectorId: 'sec1', standIds: ['e-new-1-st1'] },
    { priceCents: 15_000_000, standIds: ['e-new-1-st2'] },
  ]);

  // Publish for real
  await page.getByRole('button', { name: 'Publicar evento' }).click();
  await page.getByRole('button', { name: 'Sí, publicar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Publicamos el evento' })).toBeVisible();
  await expect(page.locator('header').getByText('Publicado')).toBeVisible();
  expect(api.events[0].status).toBe('PUBLISHED');
  expect(await seriousViolations(page)).toEqual([]);
});

const PLAN_NORTE: ApiTemplate = {
  id: 'tpl1',
  name: 'Salón norte',
  venueId: 'v1',
  versions: [
    { id: 'lv1', version: 1, status: 'ARCHIVED', publishedAt: '2026-09-01T12:00:00Z' },
    { id: 'lv2', version: 2, status: 'PUBLISHED', publishedAt: '2026-10-01T12:00:00Z' },
  ],
};

test('staff clones a plan version into a new plan and opens its draft; the original stays', async ({
  page,
}) => {
  const api = await mockApi(page, {
    role: 'OPERATOR',
    venues: [VENUE, { ...VENUE, id: 'v2', name: 'Predio Sur' }],
    templates: [structuredClone(PLAN_NORTE)],
    events: [],
  });
  await page.goto('/organizador/plano');
  await page.getByRole('button', { name: 'Clonar versión 1' }).click();
  const form = page.getByRole('form', { name: /Clonar Salón norte · versión 1/ });
  await expect(form.getByLabel('Nombre del plano nuevo')).toHaveValue('Salón norte (copia)');
  expect(await seriousViolations(page)).toEqual([]);

  await form.getByLabel('Nombre del plano nuevo').fill('Salón sur');
  await form.getByLabel('Predio').selectOption({ label: 'Predio Sur' });
  await form.getByRole('button', { name: 'Clonar y abrir el editor' }).click();
  await expect(page).toHaveURL(/\/organizador\/layouts\/tpl2-v1\/editor$/);
  await expect(page.getByText('Versión 1 · Borrador')).toBeVisible();
  expect(
    api.requests.find((r) => r.method === 'POST' && r.path === '/layout-templates/tpl1/clone')
      ?.body,
  ).toEqual({ name: 'Salón sur', sourceVersionId: 'lv1', venueId: 'v2' });
  expect(api.templates.map((t) => [t.name, t.venueId])).toEqual([
    ['Salón norte', 'v1'],
    ['Salón sur', 'v2'],
  ]);
  expect(api.templates[0].versions.map((v) => v.status)).toEqual(['ARCHIVED', 'PUBLISHED']);
});

test('cloning with a taken name keeps the form open with the reason', async ({ page }) => {
  await mockApi(page, { role: 'OWNER', venues: [VENUE], templates: [structuredClone(PLAN_NORTE)] });
  await page.goto('/organizador/plano');
  await page.getByRole('button', { name: 'Clonar versión 1' }).click();
  await page.getByLabel('Nombre del plano nuevo').fill('salón norte');
  await page.getByRole('button', { name: 'Clonar y abrir el editor' }).click();
  await expect(page.getByRole('alert')).toContainText('Ya tenés un plano con ese nombre');
  await expect(page).toHaveURL(/\/organizador\/plano$/);
});

test('the event detail names its plan version and says how to use another one', async ({
  page,
}) => {
  await mockApi(page, {
    role: 'OWNER',
    venues: [VENUE],
    templates: [structuredClone(PLAN_NORTE)],
    events: [
      {
        ...EVENT,
        id: 'e-old',
        venueId: 'v1',
        layoutVersionId: 'lv1',
        status: 'DRAFT',
        publishedAt: null,
      },
    ],
    eventStands: { 'e-old': [stand(1)] },
    eventSectors: { 'e-old': [] },
  });
  await page.goto('/organizador/eventos/e-old');
  const plan = page.getByTestId('event-plan');
  await expect(plan).toContainText('Plano del evento: Salón norte · versión 1 (archivada)');
  await expect(plan).toContainText('Para usar otro plano, creá un evento nuevo.');
  expect(await seriousViolations(page)).toEqual([]);
  await plan.getByRole('link', { name: 'creá un evento nuevo' }).click();
  await expect(page).toHaveURL(/\/organizador\/eventos\?nuevo=1$/);
  await expect(page.getByRole('heading', { name: 'Nuevo evento' })).toBeVisible();
});

test('the new-event form offers the published version of every plan of the venue', async ({
  page,
}) => {
  await mockApi(page, {
    role: 'OWNER',
    venues: [VENUE],
    templates: [
      structuredClone(PLAN_NORTE),
      {
        id: 'tpl2',
        name: 'Galpón',
        venueId: 'v1',
        versions: [
          { id: 'g1', version: 1, status: 'ARCHIVED', publishedAt: '2026-08-01T12:00:00Z' },
          { id: 'g3', version: 3, status: 'PUBLISHED', publishedAt: '2026-10-05T12:00:00Z' },
          { id: 'g4', version: 4, status: 'DRAFT', publishedAt: null },
        ],
      },
    ],
    events: [],
  });
  await page.goto('/organizador/eventos?nuevo=1');
  await expect(page.getByLabel('Plano publicado').locator('option')).toHaveText([
    'Elegí un plano',
    'Salón norte · versión 2',
    'Galpón · versión 3',
  ]);
});

test('an operator cannot publish: the button is disabled and says why', async ({ page }) => {
  await mockApi(page, {
    role: 'OPERATOR',
    venues: [VENUE],
    events: [{ ...EVENT, id: 'e-draft', venueId: 'v1', status: 'DRAFT', publishedAt: null }],
    eventStands: { 'e-draft': [stand(1)] },
    eventSectors: { 'e-draft': [] },
  });
  await page.goto('/organizador/eventos/e-draft');
  await expect(page.getByRole('button', { name: 'Publicar evento' })).toBeDisabled();
  await expect(page.getByTestId('publish-limited')).toContainText('propietarios y administradores');
  expect(await seriousViolations(page)).toEqual([]);
});

test('deleting a venue asks for confirmation first (admin)', async ({ page }) => {
  await mockApi(page, { role: 'ADMIN', venues: [VENUE] });
  await page.goto('/organizador/predios');
  await page.getByRole('button', { name: 'Eliminar Predio Norte' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('¿Eliminar Predio Norte?');
  await page.getByRole('button', { name: 'Sí, eliminar' }).click();
  await expect(page.getByText('Todavía no hay predios')).toBeVisible();
});

test('an operator sees the venues but cannot delete them', async ({ page }) => {
  await mockApi(page, { role: 'OPERATOR', venues: [VENUE] });
  await page.goto('/organizador/predios');
  await expect(page.getByRole('row', { name: /Predio Norte/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Eliminar/ })).toHaveCount(0);
  await expect(page.getByTestId('remove-limited')).toBeVisible();
});

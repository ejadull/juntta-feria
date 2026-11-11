import { expect, test } from '@playwright/test';
import {
  EVENT,
  mockApi,
  seriousViolations,
  type ApiStand,
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

import { expect, test } from '@playwright/test';
import { mockApi, seriousViolations } from './support/mock-api';

/** Dashboard, plan entry and exhibitors read the API (REP-01, LAY-01, EXH-01), with their empty states. */

test('the dashboard shows the metrics of the current event from the API', async ({ page }) => {
  const api = await mockApi(page, { role: 'OWNER' });
  await page.goto('/organizador/panel');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Panel del evento');
  await expect(page.getByText('Feria Demo').first()).toBeVisible();
  await expect(page.locator('app-kpi-card', { hasText: 'Stands comercializables' })).toContainText(
    '3',
  );
  await expect(page.getByText('Datos de demostración')).toHaveCount(0);
  expect(api.requests.some((r) => r.path === '/events/e1/metrics')).toBe(true);
  expect(await seriousViolations(page)).toEqual([]);
});

test('the dashboard explains what to do when the organization has no events', async ({ page }) => {
  await mockApi(page, { role: 'OWNER', events: [] });
  await page.goto('/organizador/panel');
  await expect(page.getByText('Todavía no hay eventos')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Vincular Mercado Pago' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('"Editor de plano" opens the layout of the current event', async ({ page }) => {
  await mockApi(page, { role: 'OWNER' });
  await page.goto('/organizador/panel');
  // Wait for the panel: it also renders an "Editor de plano" link, so use the navigation's one.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Panel del evento');
  await page
    .getByRole('navigation', { name: 'Secciones del organizador' })
    .getByRole('link', { name: 'Editor de plano' })
    .click();
  await expect(page).toHaveURL(/\/organizador\/layouts\/lv1\/editor$/);
  await expect(page.getByText('Versión 1 · Publicada')).toBeVisible();
});

test('"Editor de plano" says there is no plan when there are no events', async ({ page }) => {
  await mockApi(page, { role: 'OWNER', events: [] });
  await page.goto('/organizador/plano');
  await expect(page.getByText('Todavía no hay un plano para editar')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('the exhibitors screen lists the API exhibitors', async ({ page }) => {
  await mockApi(page, { role: 'ADMIN' });
  await page.goto('/organizador/expositores');
  await expect(page.getByText('2 de 2 expositores')).toBeVisible();
  await page.getByRole('button', { name: /Lanas del Limay/ }).click();
  await expect(page.getByRole('complementary', { name: 'Ficha del expositor' })).toContainText(
    '20-00000001-5',
  );
});

test('the exhibitors screen explains there are none yet', async ({ page }) => {
  await mockApi(page, { role: 'ADMIN', exhibitors: [] });
  await page.goto('/organizador/expositores');
  await expect(page.getByText('Todavía no hay expositores')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './support/mock-api';

/** P12 (PAY-07): link, see and unlink the organization's Mercado Pago account, with axe. */

const seriousViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

test.beforeEach(async ({ page }) => {
  await mockApi(page, { role: 'OWNER' });
});

test('organizer links and unlinks the Mercado Pago account', async ({ page }) => {
  await page.goto('/organizador/panel');
  await page
    .getByRole('navigation', { name: 'Secciones del organizador' })
    .getByRole('link', { name: 'Mercado Pago' })
    .click();
  await expect(page).toHaveURL(/\/organizador\/mercado-pago$/);
  await expect(page.locator('.status')).toContainText('Sin vincular');
  expect(await seriousViolations(page)).toEqual([]);

  // The demo adapter skips Mercado Pago and lands on the return page, like the real redirect.
  await page.getByRole('button', { name: 'Vincular cuenta de Mercado Pago' }).click();
  await expect(page).toHaveURL(/\/organizador\/mercado-pago$/);
  await expect(page.locator('.status')).toContainText('Vinculada');
  await expect(page.getByText('Pruebas (sandbox)')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole('button', { name: 'Desvincular' }).click();
  const dialog = page.getByRole('alertdialog', { name: '¿Desvincular la cuenta?' });
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  expect(await seriousViolations(page)).toEqual([]);
  await dialog.getByRole('button', { name: 'Sí, desvincular' }).click();
  await expect(page.locator('.status')).toContainText('Sin vincular');
});

test('a forged or cancelled return explains the problem, with no serious axe violations', async ({
  page,
}) => {
  await page.goto('/organizador/mercado-pago/vincular?code=x&state=forged');
  await expect(page.getByRole('alert')).toContainText('no es válida o venció');
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto('/organizador/mercado-pago/vincular?error=access_denied');
  await expect(page.getByRole('alert')).toContainText('Cancelaste');
  await page.getByRole('link', { name: 'Volver a Mercado Pago' }).click();
  await expect(page).toHaveURL(/\/organizador\/mercado-pago$/);
});

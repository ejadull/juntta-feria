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

  // The mocked authorization URL sends the browser straight to the return page, as Mercado Pago does.
  await page.getByRole('button', { name: 'Vincular cuenta de Mercado Pago' }).click();
  await expect(page).toHaveURL(/\/organizador\/mercado-pago$/);
  await expect(page.locator('.status')).toContainText('Vinculada');
  await expect(page.getByText('Pruebas (sandbox)')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole('button', { name: 'Desvincular' }).click();
  const dialog = page.getByRole('dialog', { name: '¿Desvincular la cuenta?' });
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  expect(await seriousViolations(page)).toEqual([]);
  // Esc cancels and the browser hands the focus back to the button that opened the dialog.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Desvincular' })).toBeFocused();

  await page.getByRole('button', { name: 'Desvincular' }).click();
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

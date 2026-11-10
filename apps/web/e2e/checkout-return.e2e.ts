import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** P19 (PAY-04): Mercado Pago checkout returns, against the demo API adapter, with axe. */

const seriousViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

const base = '/feriante/reservas';

test('an approved return waits for the webhook and ignores forged query params', async ({
  page,
}) => {
  await page.goto(`${base}/demo-pendiente/pago/aprobado?status=approved&payment_id=1`);
  // The API still says PAYMENT_PENDING: no confirmation, whatever the query says.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Estamos confirmando tu pago');
  expect(await seriousViolations(page)).toEqual([]);

  await page.goto(`${base}/demo-aprobada/pago/aprobado`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    '¡Listo! Tu stand está confirmado',
    { timeout: 15_000 },
  );
  expect(await seriousViolations(page)).toEqual([]);
});

test('a pending return explains offline payments', async ({ page }) => {
  await page.goto(`${base}/demo-pendiente/pago/pendiente`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu pago está pendiente');
  await expect(page.getByText('Rapipago o Pago Fácil')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('a rejected return retries within the hold', async ({ page }) => {
  await page.goto(`${base}/demo-rechazada/pago/rechazado`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('El pago fue rechazado');
  expect(await seriousViolations(page)).toEqual([]);

  // The demo API has no public key, so the Wallet Brick falls back to its init_point link; the
  // demo link skips Mercado Pago and lands on the approved return (a full page load, as with the
  // real redirect), which waits for the API instead of trusting the return.
  await page.getByRole('button', { name: 'Reintentar el pago' }).click();
  await page.getByRole('link', { name: 'Pagar con Mercado Pago' }).click();
  await expect(page).toHaveURL(/demo-rechazada\/pago\/aprobado$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Estamos confirmando tu pago');
});

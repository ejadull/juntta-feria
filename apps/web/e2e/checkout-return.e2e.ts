import { expect, test } from '@playwright/test';
import {
  CHECKOUT_URL,
  mockApi,
  reservation,
  seriousViolations,
  type MockApi,
} from './support/mock-api';

/** P19 (PAY-04): Mercado Pago checkout returns, against a mocked API, with axe. */

const base = '/feriante/reservas';

const withReservations = (page: Parameters<typeof mockApi>[0]) =>
  mockApi(page, {
    reservations: [
      reservation({ id: 'demo-pendiente', status: 'PAYMENT_PENDING' }),
      reservation({ id: 'demo-aprobada', status: 'PAYMENT_PENDING' }),
      reservation({ id: 'demo-rechazada', status: 'HELD' }),
    ],
  });

const confirmLater = (api: MockApi, id: string) =>
  setTimeout(() => {
    const target = api.reservations.find((r) => r.id === id);
    if (target) target.status = 'CONFIRMED';
  }, 1_500);

test('an approved return waits for the webhook and ignores forged query params', async ({
  page,
}) => {
  const api = await withReservations(page);
  await page.goto(`${base}/demo-pendiente/pago/aprobado?status=approved&payment_id=1`);
  // The API still says PAYMENT_PENDING: no confirmation, whatever the query says.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Estamos confirmando tu pago');
  expect(await seriousViolations(page)).toEqual([]);

  confirmLater(api, 'demo-aprobada');
  await page.goto(`${base}/demo-aprobada/pago/aprobado`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    '¡Listo! Tu stand está confirmado',
    { timeout: 15_000 },
  );
  expect(await seriousViolations(page)).toEqual([]);
});

test('a pending return explains offline payments', async ({ page }) => {
  await withReservations(page);
  await page.goto(`${base}/demo-pendiente/pago/pendiente`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu pago está pendiente');
  await expect(page.getByText('Rapipago o Pago Fácil')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('a rejected return retries within the hold', async ({ page }) => {
  await withReservations(page);
  await page.goto(`${base}/demo-rechazada/pago/rechazado`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('El pago fue rechazado');
  expect(await seriousViolations(page)).toEqual([]);

  // The API gives no public key, so the Wallet Brick falls back to the Checkout Pro link.
  await page.getByRole('button', { name: 'Reintentar el pago' }).click();
  await expect(page.getByRole('link', { name: 'Pagar con Mercado Pago' })).toHaveAttribute(
    'href',
    CHECKOUT_URL,
  );
});

test('the return page asks for sign in first and brings the user back', async ({ page }) => {
  await mockApi(page, { signedIn: false, reservations: [reservation({ id: 'demo-rechazada' })] });
  await page.goto(`${base}/demo-rechazada/pago/rechazado`);
  await expect(page).toHaveURL(/\/ingresar\?volver=/);
});

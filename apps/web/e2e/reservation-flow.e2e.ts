import { expect, test, type Page } from '@playwright/test';
import {
  CHECKOUT_URL,
  EMAIL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CREDENTIALS,
  mockApi,
  reservation,
  seriousViolations,
  stubGoogle,
} from './support/mock-api';

/** P01, P07, P18 and "Mis reservas": the exhibitor reserves and pays, against a mocked API. */

/** Signs in through the stubbed Google button (the only way in, ADR 0008). */
async function signIn(page: Page) {
  await page.getByRole('button', { name: 'Ingresar con Google' }).click();
}

async function signedOutApi(page: Page) {
  const api = await mockApi(page, { signedIn: false, googleClientId: GOOGLE_CLIENT_ID });
  await stubGoogle(page, GOOGLE_CREDENTIALS.registered);
  return api;
}

test('signs in, picks a stand, holds it and reaches the Mercado Pago payment', async ({ page }) => {
  const api = await signedOutApi(page);
  await page.goto('/feriante/explorar');
  await expect(page).toHaveURL(/\/ingresar\?volver=%2Fferiante%2Fexplorar$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Entrá a tu cuenta');
  expect(await seriousViolations(page)).toEqual([]);

  await signIn(page);
  await expect(page).toHaveURL(/\/feriante\/explorar$/);
  await expect(page.getByTestId('session-email')).toHaveText(EMAIL);
  await expect(page.locator('.stand-list-heading')).toHaveText(/2 stands disponibles/);
  expect(await seriousViolations(page)).toEqual([]);

  await page.locator('.stand-list button[data-code="S2"]').click();
  await page.getByRole('link', { name: 'Reservar el stand S2' }).click();
  await expect(page).toHaveURL(/\/feriante\/reservas\/nueva\?stand=es2&feria=feria-demo$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Resumen' })).toBeVisible();

  const reserve = page.getByRole('button', { name: 'Reservar y pagar' });
  await expect(reserve).toBeDisabled();
  await page.getByRole('checkbox', { name: /términos y condiciones/ }).check();
  expect(await seriousViolations(page)).toEqual([]);
  await reserve.click();

  await expect(page.getByRole('link', { name: 'Pagar con Mercado Pago' })).toHaveAttribute(
    'href',
    CHECKOUT_URL,
  );
  await expect(page.getByTestId('hold-clock')).toHaveText(/^1[45]:\d\d$/);
  expect(await seriousViolations(page)).toEqual([]);

  const hold = api.requests.find((r) => r.method === 'POST' && r.path === '/reservations')!;
  expect(hold.body).toEqual({ eventStandId: 'es2', termsVersion: '2026-11' });
  expect(hold.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(hold.headers['authorization']).toBe('Bearer access-token');
  expect(hold.headers['x-tenant-id']).toBe('t1');
  const checkout = api.requests.find((r) => r.path === '/reservations/r-new/checkout')!;
  expect(checkout.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
});

test('keeps the token out of web storage', async ({ page }) => {
  await signedOutApi(page);
  await page.goto('/ingresar');
  await signIn(page);
  await expect(page).toHaveURL(/\/feriante\/explorar$/);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('access-token');
});

test('explains that a subscription is needed and links to it', async ({ page }) => {
  await mockApi(page, { holdProblem: { status: 403, code: 'SUBSCRIPTION_REQUIRED' } });
  await page.goto('/feriante/reservas/nueva?stand=es2&feria=feria-demo');
  await page.getByRole('checkbox', { name: /términos y condiciones/ }).check();
  await page.getByRole('button', { name: 'Reservar y pagar' }).click();
  await expect(page.getByRole('alert')).toContainText('suscripción activa');
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole('link', { name: 'Activar mi suscripción' }).click();
  await expect(page).toHaveURL(/\/feriante\/suscripcion$/);
});

test('tells the exhibitor when somebody else took the stand', async ({ page }) => {
  await mockApi(page, { holdProblem: { status: 409, code: 'STAND_UNAVAILABLE' } });
  await page.goto('/feriante/reservas/nueva?stand=es2&feria=feria-demo');
  await page.getByRole('checkbox', { name: /términos y condiciones/ }).check();
  await page.getByRole('button', { name: 'Reservar y pagar' }).click();
  await expect(page.getByRole('alert')).toContainText('Alguien se llevó este stand');
});

test('lists the reservations and resumes the payment of a live hold', async ({ page }) => {
  await mockApi(page, {
    reservations: [
      reservation({ id: 'r1', status: 'HELD' }),
      reservation({ id: 'r2', status: 'CONFIRMED', stand: { id: 'es3', code: 'S3', areaM2: 9 } }),
    ],
  });
  await page.goto('/feriante/reservas');
  const rows = page.getByTestId('reservation');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Stand S2');
  await expect(rows.first()).toContainText('Feria Demo');
  await expect(rows.first()).toContainText('Retenida');
  await expect(rows.nth(1)).toContainText('Confirmada');
  await expect(rows.nth(1).getByRole('link', { name: /Pagar/ })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);

  await rows.first().getByRole('link', { name: 'Pagar el stand S2' }).click();
  await expect(page).toHaveURL(/\/feriante\/reservas\/nueva\?reserva=r1$/);
  await expect(page.getByRole('link', { name: 'Pagar con Mercado Pago' })).toHaveAttribute(
    'href',
    CHECKOUT_URL,
  );
});

test('shows an empty state without reservations', async ({ page }) => {
  await mockApi(page);
  await page.goto('/feriante/reservas');
  await expect(page.getByText('Todavía no reservaste ningún stand')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('signing out sends the user to sign in', async ({ page }) => {
  await mockApi(page);
  await page.goto('/feriante/reservas');
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page).toHaveURL(/\/ingresar$/);
  await page.goto('/feriante/reservas');
  await expect(page).toHaveURL(/\/ingresar\?volver=/);
});

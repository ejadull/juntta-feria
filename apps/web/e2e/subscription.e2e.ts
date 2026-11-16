import { expect, test } from '@playwright/test';
import { EMAIL, future, mockApi, seriousViolations, SUBSCRIBE_URL } from './support/mock-api';

/** EXH-05: the exhibitor's platform subscription, against a mocked API, with axe. */

test('subscribes with the payer email and is sent to Mercado Pago', async ({ page }) => {
  const api = await mockApi(page, { subscription: { status: 'NONE' } });
  await page.route('https://www.mercadopago.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Mercado Pago</h1>' }),
  );
  await page.goto('/feriante/suscripcion');
  await expect(page.getByTestId('subscription-status')).toContainText('Sin suscripción');
  const email = page.getByLabel('Email de tu cuenta de Mercado Pago');
  await expect(email).toHaveValue(EMAIL);
  expect(await seriousViolations(page)).toEqual([]);

  await email.fill('comprador@testuser.com');
  await page.getByRole('button', { name: 'Suscribirme' }).click();
  await expect(page).toHaveURL(SUBSCRIBE_URL);

  const start = api.requests.find((r) => r.method === 'POST' && r.path === '/me/subscription')!;
  expect(start.body).toEqual({ payerEmail: 'comprador@testuser.com' });
  expect(start.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  // Global per user: no organization header.
  expect(start.headers['x-tenant-id']).toBeUndefined();
});

test('coming back from Mercado Pago waits for the activation', async ({ page }) => {
  const api = await mockApi(page, {
    subscription: { status: 'PENDING', initPoint: SUBSCRIBE_URL },
  });
  await page.goto('/feriante/suscripcion');
  await expect(page.getByTestId('subscription-status')).toContainText('Pendiente de autorización');
  expect(await seriousViolations(page)).toEqual([]);
  // The webhook lands: the next read shows the activation.
  api.subscription = { status: 'ACTIVE', currentPeriodEnd: future(60 * 24 * 30) };
  await expect(page.getByTestId('subscription-status')).toContainText('Activa hasta el', {
    timeout: 15_000,
  });
});

test('cancelling asks first and keeps access until the end of the period', async ({ page }) => {
  await mockApi(page, {
    subscription: { status: 'ACTIVE', currentPeriodEnd: future(60 * 24 * 10) },
  });
  await page.goto('/feriante/suscripcion');
  await page.getByRole('button', { name: 'Cancelar suscripción' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  expect(await seriousViolations(page)).toEqual([]);

  await dialog.getByRole('button', { name: 'Sí, cancelar' }).click();
  await expect(page.getByTestId('subscription-status')).toContainText(
    'Cancelada: sigue activa hasta el',
  );
  await expect(dialog).toHaveCount(0);
});

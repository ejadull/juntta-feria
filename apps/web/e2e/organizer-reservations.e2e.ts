import { expect, test } from '@playwright/test';
import { future, mockApi, reservation, seriousViolations, type MockApi } from './support/mock-api';

/** P09 (RES-01, PAY-05, PAY-06): the organizer's reservations and payments, against a mocked API, with axe. */

const paid = { status: 'APPROVED', paymentStatus: 'approved', updatedAt: '2026-11-10T16:00:00Z' };

const seed = (page: Parameters<typeof mockApi>[0], role: 'OWNER' | 'OPERATOR' = 'OWNER') =>
  mockApi(page, {
    role,
    reservations: [
      reservation({
        id: 'r1',
        status: 'HELD',
        holdExpiresAt: future(10),
        stand: { id: 'es1', code: 'S1', areaM2: 9 },
      }),
      reservation({
        id: 'r2',
        status: 'PAYMENT_PENDING',
        stand: { id: 'es2', code: 'S2', areaM2: 9 },
        payment: { ...paid, status: 'PENDING', paymentStatus: 'pending' },
      }),
      reservation({
        id: 'r3',
        status: 'CONFIRMED',
        holdExpiresAt: null,
        stand: { id: 'es3', code: 'S3', areaM2: 9 },
        payment: paid,
      }),
      reservation({
        id: 'r4',
        status: 'EXPIRED',
        holdExpiresAt: null,
        stand: { id: 'es4', code: 'S4', areaM2: 9 },
      }),
    ],
    incidents: [
      {
        id: 'i1',
        code: 'LATE_PAYMENT_CONFLICT',
        reservationId: 'r4',
        createdAt: '2026-11-10T18:00:00Z',
      },
    ],
  });

const last = (api: MockApi, suffix: string) =>
  api.requests.filter((r) => r.path.endsWith(suffix)).at(-1);

test('the organizer sees reservations, filters them and the incidents, with no serious axe violations', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/organizador/panel');
  await page
    .getByRole('navigation', { name: 'Secciones del organizador' })
    .getByRole('link', { name: 'Reservas y cobros' })
    .click();
  await expect(page).toHaveURL(/\/organizador\/reservas$/);

  await expect(page.getByTestId('reservation')).toHaveCount(4);
  const row = page.getByRole('row', { name: /S3/ });
  await expect(row).toContainText('Textiles Ana');
  await expect(row).toContainText('ana@example.test');
  await expect(row).toContainText('Confirmada');
  await expect(row).toContainText('Aprobado');
  await expect(page.getByRole('table', { name: /Reservas del evento Feria Demo/ })).toBeVisible();
  await expect(page.getByTestId('incident')).toContainText('Pago tardío');
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole('button', { name: /Confirmada \(1\)/ }).click();
  await expect(page.getByTestId('reservation')).toHaveCount(1);
  await page.getByRole('button', { name: /Todas \(4\)/ }).click();
  await expect(page.getByTestId('reservation')).toHaveCount(4);
});

test('cancelling a hold asks for confirmation first', async ({ page }) => {
  const api = await seed(page);
  await page.goto('/organizador/reservas');
  await page.getByRole('button', { name: 'Cancelar del stand S1' }).click();
  const dialog = page.getByRole('alertdialog', { name: '¿Cancelar la reserva?' });
  await expect(dialog.getByRole('button', { name: 'No, volver' })).toBeFocused();
  expect(await seriousViolations(page)).toEqual([]);
  expect(last(api, '/cancel')).toBeUndefined();

  await dialog.getByRole('button', { name: 'Sí, cancelar reserva' }).click();
  await expect(page.getByTestId('notice')).toContainText('Reserva cancelada');
  await expect(page.getByRole('row', { name: /S1/ })).toContainText('Cancelada');
  expect(last(api, '/cancel')?.method).toBe('POST');
});

test('refunds a confirmed reservation partially, with its own Idempotency-Key', async ({
  page,
}) => {
  const api = await seed(page);
  await page.goto('/organizador/reservas');
  await page.getByRole('button', { name: 'Devolver pago del stand S3' }).click();
  await page.getByLabel('Monto a devolver en pesos (opcional)').fill('5000');
  await page.getByRole('button', { name: 'Sí, devolver' }).click();
  await expect(page.getByTestId('notice')).toContainText('Pedimos la devolución');
  const refund = last(api, '/refunds');
  expect(refund?.body).toEqual({ amountCents: 500_000 });
  expect(refund?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole('row', { name: /S3/ })).toContainText('Confirmada');
});

test('a full refund frees the stand; a refused one explains why', async ({ page }) => {
  const api = await seed(page);
  api.refundProblem = { status: 422, code: 'REFUND_WINDOW_CLOSED' };
  await page.goto('/organizador/reservas');
  await page.getByRole('button', { name: 'Devolver pago del stand S3' }).click();
  await page.getByRole('button', { name: 'Sí, devolver' }).click();
  await expect(page.getByRole('alertdialog').getByRole('alert')).toContainText('180 días');

  api.refundProblem = null;
  await page.getByRole('button', { name: 'Sí, devolver' }).click();
  await expect(page.getByTestId('notice')).toContainText('Pago devuelto');
  await expect(page.getByRole('row', { name: /S3/ })).toContainText('Devuelta');
});

test('an incident leads to a refund of its reservation', async ({ page }) => {
  const api = await seed(page);
  await page.goto('/organizador/reservas');
  await page.getByRole('button', { name: 'Devolver pago del stand S4' }).click();
  await page.getByRole('button', { name: 'Sí, devolver' }).click();
  await expect(page.getByTestId('notice')).toBeVisible();
  expect(last(api, '/refunds')?.path).toBe('/reservations/r4/refunds');
});

test('an operator releases holds but sees no refunds or incidents', async ({ page }) => {
  const api = await seed(page, 'OPERATOR');
  await page.goto('/organizador/reservas');
  await expect(page.getByTestId('reservation')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Cancelar del stand S1' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Devolver pago/ })).toHaveCount(0);
  await expect(page.getByText('solo quienes administran')).toBeVisible();
  expect(api.requests.some((r) => r.path === '/payment-incidents')).toBe(false);
});

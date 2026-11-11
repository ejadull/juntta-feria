import { expect, test } from '@playwright/test';
import { mockApi } from './support/mock-api';

/**
 * PUB-UI-06: delta-spec scenarios of `public-catalog` end to end. The visitor portal reads the
 * public API anonymously and the exhibitor area the tenant one; both are mocked here.
 */

test('an exhibitor sees only the feriante area and is kept out of the organizer one', async ({
  page,
}) => {
  await mockApi(page, { role: 'EXHIBITOR' });
  await page.goto('/organizador/panel');
  await expect(page).toHaveURL(/\/feriante\/explorar$/);
  await expect(page.getByRole('navigation', { name: 'Secciones del feriante' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Secciones del organizador' })).toHaveCount(0);
  await expect(page.getByText('Ver como')).toHaveCount(0);
});

test('staff sees only the organizer area and is kept out of the exhibitor one', async ({
  page,
}) => {
  await mockApi(page, { role: 'ADMIN' });
  await page.goto('/');
  await expect(page).toHaveURL(/\/organizador\/panel$/);
  await expect(page.getByRole('navigation', { name: 'Secciones del organizador' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Secciones del feriante' })).toHaveCount(0);

  await page.goto('/feriante/reservas');
  await expect(page).toHaveURL(/\/organizador\/panel$/);
});

test('an anonymous visitor sees only the visitor navigation and can sign in', async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/');
  await expect(page).toHaveURL(/\/ferias$/);
  await expect(page.getByRole('navigation', { name: 'Secciones del visitante' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ingresar' })).toBeVisible();

  await page.goto('/organizador/panel');
  await expect(page).toHaveURL(/\/ingresar\?volver=%2Forganizador%2Fpanel$/);
});

test('feriante filters by sector and picks a stand from the list', async ({ page }) => {
  await mockApi(page);
  await page.goto('/feriante/explorar');
  await expect(page.locator('.stand-list-heading')).toHaveText(/2 stands disponibles/);

  await page
    .getByRole('group', { name: 'Sector' })
    .getByRole('button', { name: 'Diseño y moda' })
    .click();
  const items = page.locator('.stand-list button');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('Diseño y moda');

  const code = await items.first().getAttribute('data-code');
  await items.first().click();
  await expect(page.locator(`app-stand-map [data-code="${code}"]`)).toHaveClass(/selected/);
  await expect(page.locator('.stand-detail')).toContainText(`Stand ${code}`);
  await expect(page.getByRole('link', { name: `Reservar el stand ${code}` })).toBeEnabled();
});

test('visitor finds a fair without accents and sees only public exhibitors, anonymously', async ({
  page,
}) => {
  const api = await mockApi(page, { signedIn: false });
  await page.goto('/ferias');
  await expect(page.locator('.fair h2')).toHaveText(['Feria Demo', 'Feria del Litoral']);
  await page.getByRole('searchbox').fill('neuquen');
  await expect(page.locator('.fair h2')).toHaveText(['Feria Demo']);
  await expect(page.locator('.fair')).toContainText('Organiza Asociación Demo');

  await page.getByRole('link', { name: 'Ver mapa y expositores' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Feria Demo');
  await page.locator('app-stand-map [data-code="S1"]').click();
  await expect(page.locator('.stand-card')).toContainText('Lanas del Limay');
  await expect(page.locator('main')).not.toContainText(/CUIT|Jabonería Lafken/);

  // Public calls carry no organization header and no credentials.
  const publicCalls = api.requests.filter((r) => r.path.startsWith('/public/events'));
  expect(publicCalls.length).toBeGreaterThan(0);
  for (const call of publicCalls) {
    expect(call.headers['x-tenant-id']).toBeUndefined();
    expect(call.headers['authorization']).toBeUndefined();
  }
});

test('visitor sees a clear message when there are no public fairs yet', async ({ page }) => {
  await mockApi(page, { signedIn: false, publicEvents: [] });
  await page.goto('/ferias');
  await expect(page.getByText('Todavía no hay ferias publicadas')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ingresar' }).first()).toBeVisible();
});

test('an unknown fair explains itself and offers the list', async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/ferias/no-existe');
  await expect(page.getByRole('alert')).toContainText('No encontramos el mapa público');
  await expect(page.getByRole('link', { name: 'Ver todas las ferias' })).toBeVisible();
});

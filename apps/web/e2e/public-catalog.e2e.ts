import { expect, test } from '@playwright/test';
import { mockApi } from './support/mock-api';

/**
 * PUB-UI-06: delta-spec scenarios of `public-catalog` end to end. The visitor portal still uses
 * demo data; the exhibitor area reads the real API, mocked here.
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

test('visitor finds a fair without accents and sees only public exhibitors', async ({ page }) => {
  await page.goto('/ferias');
  await page.getByRole('searchbox').fill('neuquen');
  await expect(page.locator('.fair h2')).toHaveText(['Patagonia Emprende 2026']);

  await page.getByRole('link', { name: 'Ver mapa y expositores' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Patagonia Emprende 2026');
  await page.locator('app-stand-map [data-code="A01"]').click();
  await expect(page.locator('.stand-card')).toContainText('Lanas del Limay');
  await expect(page.locator('main')).not.toContainText(/CUIT|Cordero & Lúpulo|Miel del Valle/);
});

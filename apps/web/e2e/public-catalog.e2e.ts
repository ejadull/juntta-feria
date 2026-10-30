import { expect, test } from '@playwright/test';

/** PUB-UI-06: delta-spec scenarios of `public-catalog` end to end. */

test('"Ver como" switches between the three areas', async ({ page }) => {
  await page.goto('/organizador/panel');
  const seeAs = page.getByRole('group', { name: /Ver como/ });
  await seeAs.getByRole('button', { name: 'Feriante' }).click();
  await expect(page).toHaveURL(/\/feriante\/explorar$/);
  await expect(seeAs.getByRole('button', { name: 'Feriante' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('navigation', { name: 'Secciones del feriante' })).toBeVisible();

  await seeAs.getByRole('button', { name: 'Visitante' }).click();
  await expect(page).toHaveURL(/\/ferias$/);
});

test('feriante filters by sector and picks a stand from the list', async ({ page }) => {
  await page.goto('/feriante/explorar');
  await expect(page.locator('.stand-list-heading')).toHaveText(/12 stands disponibles/);

  await page
    .getByRole('group', { name: 'Sector' })
    .getByRole('button', { name: 'Producción regional' })
    .click();
  const items = page.locator('.stand-list button');
  await expect(items.first()).toContainText('Producción regional');
  for (const text of await items.allInnerTexts()) expect(text).toContain('Producción regional');
  await expect(page.locator('app-stand-map [data-code="A01"]')).toHaveClass(/dimmed/);

  const code = await items.first().getAttribute('data-code');
  await items.first().click();
  await expect(page.locator(`app-stand-map [data-code="${code}"]`)).toHaveClass(/selected/);
  await expect(page.locator('.stand-detail')).toContainText(`Stand ${code}`);
  await expect(page.getByRole('button', { name: 'Reservar' })).toBeDisabled();
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

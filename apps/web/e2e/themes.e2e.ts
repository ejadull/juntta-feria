import { expect, test } from '@playwright/test';
import { mockApi, seriousViolations } from './support/mock-api';

/** Every palette (styles.css `:root[data-theme]`) passes axe, color contrast included. */

const PAGES = [
  '/organizador/panel',
  '/organizador/expositores',
  '/ferias',
  '/feriante/explorar',
  '/feriante/reservas',
  '/ingresar',
];

for (const theme of ['corporativo', 'grafito'] as const) {
  test(`the "${theme}" palette keeps every main page accessible`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('juntta.theme', value), theme);
    await mockApi(page);
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await seriousViolations(page), `${theme} ${path}`).toEqual([]);
    }
  });
}

test('the theme switch shows the chosen palette as pressed', async ({ page }) => {
  await mockApi(page);
  await page.goto('/ferias');
  const themes = page.getByRole('group', { name: 'Tema de colores' });
  await themes.getByRole('button', { name: 'Grafito' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'grafito');
  await expect(themes.getByRole('button', { name: 'Grafito' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

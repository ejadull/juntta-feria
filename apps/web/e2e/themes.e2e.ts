import { expect, test } from '@playwright/test';
import { mockApi, reservation, seriousViolations } from './support/mock-api';

/** Every palette (styles.css `:root[data-theme]`) passes axe, color contrast included. */

const PAGES = [
  '/organizador/panel',
  '/organizador/expositores',
  '/ferias',
  '/feriante/explorar',
  '/feriante/reservas',
  '/ingresar',
  '/organizador/layouts/demo-v1/editor',
  '/ferias/patagonia-emprende-2026',
  '/feriante/reservas/nueva?reserva=r1',
  '/feriante/reservas/r2/pago/aprobado',
];

for (const theme of ['clasico', 'corporativo', 'grafito', 'industrial', 'matcha'] as const) {
  test(`the "${theme}" palette keeps every main page accessible`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('juntta.theme', value), theme);
    await mockApi(page, {
      reservations: [reservation({ id: 'r1' }), reservation({ id: 'r2', status: 'CONFIRMED' })],
    });
    for (const path of PAGES) {
      await page.goto(path);
      if (theme !== 'clasico')
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // The editor's SVG/list aria-labels differ from their visible text (pre-existing, not a
      // palette matter); every other rule, color contrast included, still applies.
      const violations = (await seriousViolations(page)).filter(
        (v) => !(path.includes('/editor') && v.startsWith('label-content-name-mismatch')),
      );
      expect(violations, `${theme} ${path}`).toEqual([]);
    }
  });
}

test('the theme picker applies and remembers the chosen palette', async ({ page }) => {
  await mockApi(page);
  await page.goto('/ferias');
  const themes = page.getByRole('group', { name: 'Tema de colores' });
  // Grafito (paleta 2) is the default.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'grafito');
  await expect(themes.getByRole('radio', { name: 'Grafito' })).toBeChecked();

  await themes.getByRole('radio', { name: 'Clásico' }).check();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await page.reload();
  await expect(themes.getByRole('radio', { name: 'Clásico' })).toBeChecked();

  // Keyboard: arrows move through the native radio group.
  await themes.getByRole('radio', { name: 'Clásico' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'corporativo');
});

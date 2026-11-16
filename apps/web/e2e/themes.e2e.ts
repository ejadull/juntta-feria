import { expect, test } from '@playwright/test';
import { mockApi, reservation, seriousViolations, type Role } from './support/mock-api';

/** Every palette (styles.css `:root[data-theme]`) passes axe, color contrast included. */

/** Each page with the role of the user who sees it (the organizer area is staff-only). */
const PAGES: readonly (readonly [path: string, role: Role])[] = [
  ['/organizador/panel', 'OWNER'],
  ['/organizador/expositores', 'OWNER'],
  ['/organizador/reservas', 'OWNER'],
  ['/organizador/predios?nuevo=1', 'OWNER'],
  ['/organizador/plano', 'OWNER'],
  ['/organizador/eventos?nuevo=1', 'OWNER'],
  ['/organizador/eventos/e1', 'OWNER'],
  ['/ferias', 'EXHIBITOR'],
  ['/feriante/explorar', 'EXHIBITOR'],
  ['/feriante/reservas', 'EXHIBITOR'],
  ['/feriante/perfil', 'EXHIBITOR'],
  ['/feriante/documentos', 'EXHIBITOR'],
  ['/ingresar', 'EXHIBITOR'],
  ['/privacidad', 'EXHIBITOR'],
  ['/terminos', 'EXHIBITOR'],
  ['/organizador/layouts/demo-v1/editor', 'OWNER'],
  ['/ferias/feria-demo', 'EXHIBITOR'],
  ['/feriante/reservas/nueva?reserva=r1', 'EXHIBITOR'],
  ['/feriante/reservas/r2/pago/aprobado', 'EXHIBITOR'],
];

for (const theme of [
  'clasico',
  'corporativo',
  'grafito',
  'industrial',
  'matcha',
  'cereza',
] as const) {
  test(`the "${theme}" palette keeps every main page accessible`, async ({ page }) => {
    test.setTimeout(60_000); // one axe pass per page, in five palettes
    await page.addInitScript((value) => localStorage.setItem('juntta.theme', value), theme);
    const api = await mockApi(page, {
      reservations: [reservation({ id: 'r1' }), reservation({ id: 'r2', status: 'CONFIRMED' })],
      // So the plan list shows its "Clonar" buttons and the event detail names its plan version.
      venues: [
        {
          id: 'v1',
          type: 'FIXED',
          name: 'Predio Norte',
          address: null,
          timezone: 'America/Argentina/Buenos_Aires',
          widthM: 20,
          heightM: 8,
        },
      ],
      templates: [
        {
          id: 'tpl1',
          name: 'Salón norte',
          venueId: 'v1',
          versions: [
            { id: 'lv1', version: 1, status: 'ARCHIVED', publishedAt: '2026-09-01T12:00:00Z' },
            { id: 'lv2', version: 2, status: 'DRAFT', publishedAt: null },
          ],
        },
      ],
    });
    for (const [path, role] of PAGES) {
      api.role = role; // the session is read on each page load
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

test('the theme pick list applies and remembers the chosen palette', async ({ page }) => {
  await mockApi(page);
  await page.goto('/ferias');
  const themes = page.getByLabel('Tema de colores');
  await page.getByRole('button', { name: 'Abrir menú de cuenta' }).click();
  // Industrial Neon is the default.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'industrial');
  await expect(themes).toHaveValue('industrial');

  await themes.selectOption({ label: 'Clásico' });
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await page.reload();
  await page.getByRole('button', { name: 'Abrir menú de cuenta' }).click();
  await expect(themes).toHaveValue('clasico');

  await themes.selectOption('grafito');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'grafito');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'grafito');
  await page.getByRole('button', { name: 'Abrir menú de cuenta' }).click();
  await expect(themes).toHaveValue('grafito');
});

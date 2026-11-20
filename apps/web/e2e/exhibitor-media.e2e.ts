import { expect, test } from '@playwright/test';
import { mockApi, reservation, seriousViolations } from './support/mock-api';

/** MED-09: publications end to end (exhibitor publishes, visitor opens and shares), with axe in every theme. */

const THEMES = ['clasico', 'corporativo', 'grafito', 'industrial', 'matcha', 'cereza'] as const;

const confirmed = () => reservation({ id: 'r1', status: 'CONFIRMED', eventId: 'e1' });

test('the exhibitor publishes a photo about an event where it holds a stand, and sees its text', async ({
  page,
}) => {
  await mockApi(page, { role: 'EXHIBITOR', reservations: [confirmed()] });
  await page.goto('/feriante/perfil');

  const section = page.getByRole('region', { name: 'Publicaciones' });
  await expect(section.locator('#pub-event')).toHaveValue('e1');
  await section.getByLabel('Texto de la publicación (opcional)').fill('Mermelada de ciruela');
  await section.locator('input[type="file"]').setInputFiles({
    name: 'frasco.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.alloc(2048, 1),
  });

  await expect(section.getByRole('status')).toHaveText('Publicación subida.');
  await expect(section.getByTestId('pub-item')).toContainText('Mermelada de ciruela');
  expect(await seriousViolations(page)).toEqual([]);
});

test('a video the browser cannot read is refused before it is sent', async ({ page }) => {
  const api = await mockApi(page, { role: 'EXHIBITOR', reservations: [confirmed()] });
  await page.goto('/feriante/perfil');

  const section = page.getByRole('region', { name: 'Publicaciones' });
  await section.locator('input[type="file"]').setInputFiles({
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.alloc(2048, 2),
  });

  await expect(section.getByTestId('pub-error')).toContainText('No pudimos leer la duración');
  expect(api.requests.some((r) => r.method === 'POST' && r.path === '/exhibitors/me/photos')).toBe(
    false,
  );
});

test('a visitor reaches a shared publication with the keyboard and shares it', async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/ferias/feria-demo?publicacion=pub-1');

  const dialog = page.getByRole('dialog', { name: 'Stand S1' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('opacity', '1'); // axe must not read colors mid-fade
  await dialog.locator('video').focus();
  await expect(dialog.locator('video')).toBeFocused();
  await page.keyboard.press('Tab');
  const share = dialog.getByRole('button', { name: /Compartir: Así se tiñe/ });
  await expect(share).toBeFocused();

  await share.click();
  await expect(dialog.getByRole('list', { name: 'Opciones para compartir' })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

for (const theme of THEMES) {
  test(`publications stay accessible in "${theme}": profile section and visitor modal`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.addInitScript((value) => localStorage.setItem('juntta.theme', value), theme);

    await mockApi(page, { role: 'EXHIBITOR', reservations: [confirmed()] });
    await page.goto('/feriante/perfil');
    await expect(page.getByRole('region', { name: 'Publicaciones' })).toBeVisible();
    expect(await seriousViolations(page), `${theme} profile`).toEqual([]);

    await mockApi(page, { signedIn: false });
    await page.goto('/ferias/feria-demo?publicacion=pub-1');
    const dialog = page.getByRole('dialog', { name: 'Stand S1' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('opacity', '1'); // axe must not read colors mid-fade
    expect(await seriousViolations(page), `${theme} modal`).toEqual([]);
  });
}

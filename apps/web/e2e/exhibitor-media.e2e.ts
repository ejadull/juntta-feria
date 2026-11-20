import { expect, test, type Page } from '@playwright/test';
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

/** A WebM the browser records itself (2 s of canvas frames): a video it can read, with no binary in the repo. */
async function recordWebm(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d')!;
    const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.start();
    for (let frame = 0; frame < 20; frame++) {
      ctx.fillStyle = `hsl(${frame * 18} 80% 50%)`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop();
    await stopped;
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

test('a real WebM video is published about an event and listed as a video', async ({ page }) => {
  await mockApi(page, { role: 'EXHIBITOR', reservations: [confirmed()] });
  await page.goto('/feriante/perfil');

  const section = page.getByRole('region', { name: 'Publicaciones' });
  await expect(section.locator('#pub-event')).toHaveValue('e1');
  await section.locator('input[type="file"]').setInputFiles({
    name: 'demo.webm',
    mimeType: 'video/webm',
    buffer: await recordWebm(page),
  });

  await expect(section.getByRole('status')).toHaveText('Publicación subida.');
  await expect(section.getByTestId('pub-item').locator('video')).toHaveCount(1);
  expect(await seriousViolations(page)).toEqual([]);
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

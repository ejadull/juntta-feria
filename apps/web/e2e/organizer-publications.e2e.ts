import { expect, test } from '@playwright/test';
import { mockApi, seriousViolations, type ApiPhoto } from './support/mock-api';

/** MED-11: the organizer hides a publication of its fair, and shows it again. */

const PUBLICATION: ApiPhoto = {
  id: 'pub-9',
  status: 'READY',
  kind: 'IMAGE',
  contentType: 'image/jpeg',
  sizeBytes: 1000,
  alt: null,
  caption: 'Mermelada de ciruela',
  durationS: null,
  eventId: 'e1',
  position: 0,
  url: 'https://storage.test/media/pub-9',
};

test('the organizer hides a publication of its fair and shows it again', async ({ page }) => {
  const api = await mockApi(page, { role: 'OWNER', photos: [PUBLICATION] });
  await page.goto('/organizador/eventos/e1');
  await page.getByRole('tab', { name: 'Publicaciones' }).click();

  const row = page.getByTestId('pub-row');
  await expect(row).toContainText('Textiles Ana');
  await expect(row).toContainText('Publicada');
  await row.getByRole('button', { name: 'Ocultar' }).click();
  await expect(row).toContainText('Oculta');
  expect(api.photos[0].status).toBe('HIDDEN');

  await row.getByRole('button', { name: 'Mostrar' }).click();
  await expect(row).toContainText('Publicada');
  expect(api.photos[0].status).toBe('READY');
  expect(await seriousViolations(page)).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { mockApi, seriousViolations } from './support/mock-api';

/** MED-07: the share link of a publication opens its stand, with the video first and its text. */
test('a share link opens the stand modal with the video and its text, first', async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/ferias/feria-demo?publicacion=pub-1');

  const dialog = page.getByRole('dialog', { name: 'Stand S1' });
  await expect(dialog).toBeVisible();

  const video = dialog.locator('video.media-video');
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).toHaveAttribute('preload', 'metadata');
  await expect(video).not.toHaveAttribute('autoplay', '');
  await expect(dialog.locator('.gallery .caption')).toHaveText('Así se tiñe la lana a mano');

  // The video is the first item of the gallery, so the visitor lands on it.
  await expect(dialog.locator('.gallery > li').first().locator('video')).toHaveCount(1);
  expect(await seriousViolations(page)).toEqual([]);
});

test('without a share link the gallery keeps publications first, then the profile photo', async ({
  page,
}) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/ferias/feria-demo');
  await page.locator('app-stand-map [data-code="S1"]').focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Stand S1' });
  await expect(dialog).toBeVisible();
  // Publications keep their order; the profile photo follows them.
  await expect(dialog.locator('.gallery > li').first().locator('video')).toHaveCount(1);
  await expect(dialog.locator('.gallery img')).toHaveCount(1);
});

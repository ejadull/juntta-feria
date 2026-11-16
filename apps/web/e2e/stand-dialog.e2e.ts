import { expect, test } from '@playwright/test';
import { mockApi, seriousViolations } from './support/mock-api';

/** Visitor stand modal: native <dialog> with the exhibitor's photos, keyboard and focus included. */

test('tapping a stand with a public exhibitor opens the modal with its photos; Esc returns focus', async ({
  page,
}) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/ferias/feria-demo');

  const stand = page.locator('app-stand-map [data-code="S1"]');
  await stand.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Stand S1' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Lanas del Limay');
  await expect(dialog).toContainText('Diseño y moda');
  await expect(dialog.locator('.actions').getByRole('button', { name: 'Cerrar' })).toBeFocused();

  const photo = dialog.getByRole('img', { name: 'Telar con lanas teñidas a mano' });
  await expect(photo).toBeVisible();
  await expect(photo).toHaveAttribute('loading', 'lazy');

  await expect(dialog).toHaveCSS('opacity', '1'); // axe must not read colors mid-fade
  expect(await seriousViolations(page)).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(stand).toBeFocused();
});

test('a stand without a public exhibitor keeps the side panel and opens no modal', async ({
  page,
}) => {
  await mockApi(page, { signedIn: false });
  await page.goto('/ferias/feria-demo');

  await page.locator('app-stand-map [data-code="S2"]').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.stand-card')).toContainText('Stand S2');
});

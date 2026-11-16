import { expect, test } from '@playwright/test';
import { mockApi } from './support/mock-api';

/** Shell UX: mobile navigation popover, skip link, route focus and scroll, theme chrome. */

test.describe('mobile shell (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the navigation lives in a popover opened by a menu button', async ({ page }) => {
    await mockApi(page, { role: 'OWNER' });
    await page.goto('/organizador/panel');
    const nav = page.getByRole('navigation', { name: 'Secciones del organizador' });
    await expect(nav).toBeHidden();

    await page.getByRole('button', { name: 'Secciones' }).click();
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Panel' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('api-status')).toBeVisible();
    await expect(page.getByText('Entorno de prueba.')).toBeVisible();

    // Escape closes it, and picking a section closes it too.
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await page.getByRole('button', { name: 'Secciones' }).click();
    await nav.getByRole('link', { name: 'Eventos' }).click();
    await expect(page).toHaveURL(/\/organizador\/eventos$/);
    await expect(nav).toBeHidden();
  });

  test('the chrome above the content is compact', async ({ page }) => {
    await mockApi(page, { role: 'OWNER' });
    await page.goto('/organizador/panel');
    const top = await page.locator('main#main').evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeLessThan(130);
  });

  test('the account menu is named and opens', async ({ page }) => {
    await mockApi(page, { role: 'OWNER' });
    await page.goto('/organizador/panel');
    await page.getByRole('button', { name: 'Abrir menú de cuenta' }).click();
    await expect(page.getByLabel('Menú de cuenta', { exact: true })).toBeVisible();
  });
});

test.describe('desktop shell (1366×768)', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('the sidebar is always there and nothing scrolls', async ({ page }) => {
    await mockApi(page, { role: 'OWNER' });
    await page.goto('/organizador/panel');
    await expect(page.getByRole('navigation', { name: 'Secciones del organizador' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Secciones' })).toBeHidden();
    const overflow = await page.evaluate(() => {
      const aside = document.querySelector('app-shell > aside')!;
      const doc = document.documentElement;
      return {
        document: doc.scrollHeight - doc.clientHeight,
        aside: aside.scrollHeight - aside.clientHeight,
      };
    });
    expect(overflow).toEqual({ document: 0, aside: 0 });
  });

  test('skip link goes first, and a route change moves focus to the new heading', async ({
    page,
  }) => {
    await mockApi(page, { role: 'OWNER' });
    await page.goto('/organizador/panel');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Panel del evento');
    // Nothing steals focus on the first load.
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Saltar al contenido' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();

    await page
      .getByRole('navigation', { name: 'Secciones del organizador' })
      .getByRole('link', { name: 'Eventos' })
      .click();
    await expect(page).toHaveURL(/\/organizador\/eventos$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  });

  test('theme changes update color-scheme and theme-color', async ({ page }) => {
    await mockApi(page, { role: 'OWNER' });
    await page.goto('/organizador/panel');
    const chrome = () =>
      page.evaluate(() => ({
        scheme: document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.content,
        color: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content,
        css: getComputedStyle(document.documentElement).colorScheme,
      }));
    expect(await chrome()).toEqual({ scheme: 'light', color: '#eef0f2', css: 'light' });

    await page.getByRole('button', { name: 'Abrir menú de cuenta' }).click();
    await page.getByLabel('Tema de colores').selectOption('grafito');
    expect(await chrome()).toEqual({ scheme: 'dark', color: '#1a1a1d', css: 'dark' });
  });

  test('scroll goes back to the top on a new page', async ({ page }) => {
    await mockApi(page, { role: 'OWNER' });
    await page.goto('/organizador/panel');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Panel del evento');
    await page.locator('main#main').evaluate((el) => {
      const filler = document.createElement('div');
      filler.style.height = '3000px';
      el.appendChild(filler);
      el.scrollTop = 400;
    });
    await page
      .getByRole('navigation', { name: 'Secciones del organizador' })
      .getByRole('link', { name: 'Eventos' })
      .click();
    await expect(page).toHaveURL(/\/organizador\/eventos$/);
    await expect.poll(() => page.locator('main#main').evaluate((el) => el.scrollTop)).toBe(0);
  });
});

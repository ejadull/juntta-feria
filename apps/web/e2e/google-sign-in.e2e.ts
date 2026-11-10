import { expect, test, type Page } from '@playwright/test';
import { EMAIL, GOOGLE_CREDENTIALS, mockApi, seriousViolations } from './support/mock-api';

/** CORE-05: "Ingresar con Google" and "Continuar con Google" against a mocked API and a stubbed GIS. */

const CLIENT_ID = 'e2e-client.apps.googleusercontent.com';
const TOKEN = 'T'.repeat(43);

/**
 * Stand-in for https://accounts.google.com/gsi/client: `renderButton` draws a plain button that,
 * when clicked, calls the registered callback with `window.__googleCredential`.
 */
async function stubGoogle(page: Page, credential: string) {
  await page.addInitScript((value) => {
    (window as unknown as { __googleCredential: string }).__googleCredential = value;
  }, credential);
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
        (() => {
          let callback;
          window.google = { accounts: { id: {
            initialize: (config) => { callback = config.callback; },
            renderButton: (container, options) => {
              const button = document.createElement('button');
              button.type = 'button';
              button.textContent = options.text === 'continue_with' ? 'Continuar con Google' : 'Ingresar con Google';
              button.addEventListener('click', () => callback({ credential: window.__googleCredential }));
              container.append(button);
            },
          } } };
        })();`,
    }),
  );
}

test('signs in with Google and lands where the user was heading', async ({ page }) => {
  const api = await mockApi(page, { signedIn: false, googleClientId: CLIENT_ID });
  await stubGoogle(page, GOOGLE_CREDENTIALS.registered);
  await page.goto('/ingresar?volver=%2Fferiante%2Fexplorar');

  const group = page.getByRole('group', { name: 'Ingresar con Google' });
  await expect(group).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toBeVisible(); // the form stays usable
  expect(await seriousViolations(page)).toEqual([]);

  await group.getByRole('button', { name: 'Ingresar con Google' }).click();
  await expect(page).toHaveURL(/\/feriante\/explorar$/);
  await expect(page.getByTestId('session-email')).toHaveText(EMAIL);

  const request = api.requests.find((r) => r.path === '/auth/google')!;
  expect(request.body).toEqual({ credential: GOOGLE_CREDENTIALS.registered });
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('access-token');
});

test('tells a Google user without an account to ask the organizer for an invitation', async ({
  page,
}) => {
  await mockApi(page, { signedIn: false, googleClientId: CLIENT_ID });
  await stubGoogle(page, GOOGLE_CREDENTIALS.stranger);
  await page.goto('/ingresar');
  await page.getByRole('button', { name: 'Ingresar con Google' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'No encontramos una cuenta con ese email. Pedile una invitación al organizador.',
  );
  await expect(page).toHaveURL(/\/ingresar$/);
  expect(await seriousViolations(page)).toEqual([]);
});

test('hides the Google button when the API has no client id', async ({ page }) => {
  await mockApi(page, { signedIn: false, googleClientId: null });
  await page.goto('/ingresar');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Entrá a tu cuenta');
  await expect(page.getByRole('group', { name: 'Ingresar con Google' })).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);
});

test('accepts an invitation with "Continuar con Google"', async ({ page }) => {
  const api = await mockApi(page, {
    signedIn: false,
    googleClientId: CLIENT_ID,
    invitation: { organizationName: 'Feria Norte', email: EMAIL, name: 'Nora' },
  });
  await stubGoogle(page, GOOGLE_CREDENTIALS.registered);
  await page.goto(`/invitacion/${TOKEN}`);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Creá tu cuenta de feriante');
  await expect(page.getByText('Feria Norte te invitó')).toBeVisible();
  const group = page.getByRole('group', { name: 'Continuar con Google' });
  await expect(group).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await group.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page).toHaveURL(/\/feriante\/explorar$/);

  const accept = api.requests.find((r) => r.path.endsWith('/accept'))!;
  expect(accept.body).toEqual({
    googleCredential: GOOGLE_CREDENTIALS.registered,
    fullName: 'Nora',
  });
});

test('explains a Google account whose email is not the invited one', async ({ page }) => {
  await mockApi(page, {
    signedIn: false,
    googleClientId: CLIENT_ID,
    invitation: { organizationName: 'Feria Norte', email: EMAIL, name: null },
  });
  await stubGoogle(page, GOOGLE_CREDENTIALS.wrongEmail);
  await page.goto(`/invitacion/${TOKEN}`);
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page.getByRole('alert')).toContainText('otro email que el de la invitación');
  await expect(page).toHaveURL(/\/invitacion\//);
  expect(await seriousViolations(page)).toEqual([]);
});

test('an invalid invitation link says so', async ({ page }) => {
  await mockApi(page, { signedIn: false, googleClientId: CLIENT_ID, invitation: null });
  await page.goto(`/invitacion/${TOKEN}`);
  await expect(page.getByRole('alert')).toContainText('no es válido');
  expect(await seriousViolations(page)).toEqual([]);
});

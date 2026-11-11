import { expect, test, type Page } from '@playwright/test';
import { EVENT, mockApi } from './support/mock-api';

/**
 * LUI-10: delta-spec scenarios of `layout-editor` end to end (AC-01, AC-02, AC-04 frontend),
 * against the mocked layout API (the current event points at the demo draft).
 */

const EDITOR = '/organizador/layouts/demo-v1/editor';

const props = (page: Page, name: 'code' | 'w' | 'h' | 'x' | 'y') =>
  page.locator(`app-object-properties [name="${name}"]`);

async function setProp(page: Page, name: 'w' | 'h' | 'x' | 'y', value: number): Promise<void> {
  const input = props(page, name);
  await input.fill(String(value));
  await input.blur(); // commits on "change"
}

async function selectFromList(page: Page, id: string): Promise<void> {
  await page.locator(`app-object-list [data-id="${id}"]`).click();
  await expect(page.locator(`app-floor-plan-canvas [data-id="${id}"]`)).toHaveClass(/selected/);
}

const shape = (page: Page, id: string) => page.locator(`app-floor-plan-canvas [data-id="${id}"]`);
const publish = (page: Page) => page.getByRole('button', { name: 'Publicar' });

test.beforeEach(async ({ page }) => {
  await mockApi(page, {
    role: 'OWNER',
    events: [{ ...EVENT, layoutVersionId: 'demo-v1' }],
    // The plan entry lists the plans: this one has the demo version.
    venues: [
      {
        id: 'v1',
        type: 'FIXED',
        name: 'Predio Demo',
        address: null,
        timezone: 'America/Argentina/Buenos_Aires',
        widthM: 40,
        heightM: 25,
      },
    ],
    templates: [
      {
        id: 'demo-template',
        name: 'Plano demo',
        venueId: 'v1',
        versions: [{ id: 'demo-v1', version: 1, status: 'PUBLISHED', publishedAt: null }],
      },
    ],
  });
  await page.goto(EDITOR);
  await expect(page.locator('app-floor-plan-canvas g.shape')).toHaveCount(43);
});

test('AC-01: a 3×4 m stand keeps 12 m² and its geometry after zooming', async ({ page }) => {
  await page.getByRole('button', { name: 'Agregar' }).click();
  const created = page.locator('app-floor-plan-canvas .shape.selected');
  await expect(created).toHaveCount(1);
  const id = (await created.getAttribute('data-id'))!;

  await setProp(page, 'w', 3);
  await setProp(page, 'h', 4);
  await expect(shape(page, id).locator('.sublabel')).toHaveText('12 m²');
  const points = await shape(page, id).locator('polygon').getAttribute('points');
  // Pixels per meter of the plan. (A small shape's bounding box is skewed by non-scaling strokes.)
  const pxPerMeter = () =>
    page.evaluate(() => document.querySelector<SVGSVGElement>('svg.plan')!.getScreenCTM()!.a);
  const scaleBefore = await pxPerMeter();

  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Acercar' }).click();
  await expect(page.locator('.scale-badge')).toContainText('220%');

  await expect(shape(page, id).locator('.sublabel')).toHaveText('12 m²');
  await expect(shape(page, id).locator('polygon')).toHaveAttribute('points', points!);
  await expect(props(page, 'w')).toHaveValue('3');
  await expect(props(page, 'h')).toHaveValue('4');
  expect((await pxPerMeter()) / scaleBefore).toBeCloseTo(1.3 ** 3, 2); // only the screen scale changes
});

test('AC-02: an overlap blocks publishing; a shared edge does not', async ({ page }) => {
  // A01 is 5..8 m, A02 is 9..12 m on the same row.
  await selectFromList(page, 'demo-A01');

  await setProp(page, 'x', 6); // 6..9 touches A02 at x = 9: shared edge
  await expect(page.locator('app-validation-panel')).toContainText('Sin errores');
  await expect(publish(page)).toBeEnabled();

  await setProp(page, 'x', 7); // 7..10 overlaps A02 by 1 × 3 m
  const panel = page.locator('app-validation-panel');
  await expect(panel).toContainText('1 error bloquea la publicación');
  await expect(panel).toContainText('A01 y A02 se superponen 3 m²');
  await expect(publish(page)).toBeDisabled();
  await expect(shape(page, 'demo-A01')).toHaveClass(/invalid/);
  await expect(shape(page, 'demo-A02')).toHaveClass(/invalid/);
});

test('AC-04: a published version is read-only and a new version leaves it untouched', async ({
  page,
}) => {
  const a01 = shape(page, 'demo-A01').locator('polygon');
  const original = await a01.getAttribute('points');

  await publish(page).click();
  await expect(page.locator('.banner')).toContainText('solo lectura');
  await expect(publish(page)).toHaveCount(0);

  // Dragging a stand does nothing.
  const box = (await a01.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(a01).toHaveAttribute('points', original!);
  await expect(page.locator('app-floor-plan-canvas [data-handle]')).toHaveCount(0);

  // "Crear nueva versión" opens an editable draft with a new URL.
  await page.getByRole('button', { name: 'Crear nueva versión' }).click();
  await expect(page.getByText('Versión 2 · Borrador')).toBeVisible();
  await expect(page).not.toHaveURL(/demo-v1/);

  const copy = page.locator('app-object-list button[data-id]', { hasText: 'A01' });
  await copy.click();
  await setProp(page, 'x', 20);
  await expect(page.locator('app-floor-plan-canvas .shape.selected polygon')).not.toHaveAttribute(
    'points',
    original!,
  );

  // Back to v1 through the app (the plan entry lists the plan versions): unchanged, published.
  await page.getByRole('link', { name: 'Editor de plano' }).click();
  await page.getByRole('link', { name: 'Abrir versión 1 · Publicada' }).click();
  await expect(page.getByText('Versión 1 · Publicada')).toBeVisible();
  await expect(shape(page, 'demo-A01').locator('polygon')).toHaveAttribute('points', original!);
});

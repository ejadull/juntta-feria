import { expect, test } from '@playwright/test';
import { mockApi, seriousViolations, type ApiDocument } from './support/mock-api';

/** EXH-02 rubros and EXH-03 documents from the web, with the storage URLs mocked. */

const PDF = {
  name: 'constancia.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 x'),
};

const document = (patch: Partial<ApiDocument> = {}): ApiDocument => ({
  id: 'doc1',
  exhibitorId: 'x1',
  type: 'CONSTANCIA_AFIP',
  status: 'PENDING',
  fileName: 'constancia.pdf',
  contentType: 'application/pdf',
  sizeBytes: 10,
  uploadedAt: '2026-11-09T12:00:00Z',
  reviewedAt: null,
  rejectionReason: null,
  createdAt: '2026-11-09T12:00:00Z',
  ...patch,
});

test('staff manages the rubros: add, repeat, rename and a rubro in use cannot be deleted', async ({
  page,
}) => {
  const api = await mockApi(page, {
    role: 'OWNER',
    categories: [{ id: 'cat1', name: 'Textiles', exhibitorCount: 2 }],
  });
  await page.goto('/organizador/expositores');
  const panel = page.getByRole('region', { name: 'Rubros' });
  await expect(panel.getByText('Textiles')).toBeVisible();

  await panel.getByLabel('Nuevo rubro').fill('Cerámica');
  await panel.getByRole('button', { name: 'Agregar' }).click();
  await expect(panel.getByText('Agregamos el rubro Cerámica.')).toBeVisible();
  expect(
    api.requests.find((r) => r.method === 'POST' && r.path === '/exhibitor-categories')?.body,
  ).toEqual({ name: 'Cerámica' });
  // The exhibitor filter offers the real rubros.
  await expect(page.getByLabel('Rubro', { exact: true })).toContainText('Cerámica');

  await panel.getByLabel('Nuevo rubro').fill('cerámica');
  await panel.getByRole('button', { name: 'Agregar' }).click();
  await expect(panel.getByText('Ya tenés un rubro con ese nombre.')).toBeVisible();

  await panel.getByRole('button', { name: 'Renombrar Cerámica' }).click();
  await panel.getByLabel('Nuevo nombre de Cerámica').fill('Cerámica y alfarería');
  await panel.getByRole('button', { name: 'Guardar' }).click();
  await expect(panel.getByText('Cerámica y alfarería', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Eliminar Textiles' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('¿Eliminar el rubro Textiles?');
  await page.getByRole('button', { name: 'Sí, eliminar' }).click();
  await expect(
    panel.getByText('No se puede eliminar: hay expositores con este rubro.'),
  ).toBeVisible();
  await expect(panel.getByText('Textiles')).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test('the exhibitor completes the profile and uploads a document straight to storage', async ({
  page,
}) => {
  const api = await mockApi(page, {
    role: 'EXHIBITOR',
    categories: [
      { id: 'cat1', name: 'Textiles', exhibitorCount: 0 },
      { id: 'cat2', name: 'Cerámica', exhibitorCount: 0 },
    ],
  });
  await page.goto('/feriante/perfil');
  await page.getByLabel('Nombre comercial').fill('Barro Sur');
  await page.getByLabel('Razón social').fill('Barro Sur S.A.');
  await page.getByRole('combobox', { name: /^Rubro/ }).selectOption({ label: 'Cerámica' });
  await page.getByRole('button', { name: 'Guardar perfil' }).click();
  await expect(page.getByText('Guardamos tu perfil.')).toBeVisible();
  expect(api.profile).toMatchObject({ categoryId: 'cat2', tradeName: 'Barro Sur' });

  await page
    .getByRole('navigation', { name: 'Secciones del feriante' })
    .getByRole('link', { name: 'Mis documentos' })
    .click();
  await expect(page.getByText('Todavía no subiste documentos')).toBeVisible();

  // Wrong type is refused in the browser, before any request.
  await page.getByLabel('Archivo').setInputFiles({
    name: 'virus.exe',
    mimeType: 'application/x-msdownload',
    buffer: Buffer.from('x'),
  });
  await expect(page.getByText('Solo se aceptan archivos PDF, JPG o PNG.')).toBeVisible();
  await page.getByRole('button', { name: 'Subir documento' }).click();
  expect(
    api.requests.some((r) => r.method === 'POST' && r.path === '/exhibitors/me/documents'),
  ).toBe(false);

  await page.getByLabel('Tipo de documento').selectOption({ label: 'Constancia de AFIP' });
  await page.getByLabel('Archivo').setInputFiles(PDF);
  await page.getByRole('button', { name: 'Subir documento' }).click();
  await expect(
    page.getByText('Subimos el documento. La organización lo va a revisar.'),
  ).toBeVisible();
  const row = page.getByTestId('document-row');
  await expect(row).toContainText('Constancia de AFIP');
  await expect(row).toContainText('En revisión');
  expect(
    api.requests.find((r) => r.method === 'POST' && r.path === '/exhibitors/me/documents')?.body,
  ).toEqual({
    type: 'CONSTANCIA_AFIP',
    fileName: 'constancia.pdf',
    contentType: 'application/pdf',
    sizeBytes: PDF.buffer.length,
  });
  expect(api.uploads).toEqual([
    { documentId: 'doc1', contentType: 'application/pdf', size: PDF.buffer.length },
  ]);
  expect(await seriousViolations(page)).toEqual([]);

  await row.getByRole('button', { name: 'Eliminar constancia.pdf' }).click();
  await page.getByRole('button', { name: 'Sí, eliminar' }).click();
  await expect(page.getByText('Todavía no subiste documentos')).toBeVisible();
});

test('staff reviews a document: approve, and reject only with a reason', async ({ page }) => {
  const api = await mockApi(page, {
    role: 'OPERATOR',
    documents: [document(), document({ id: 'doc2', type: 'SEGURO', fileName: 'seguro.pdf' })],
  });
  api.exhibitors[0].documentsStatus = 'PENDING';
  await page.goto('/organizador/expositores');
  await page.getByRole('button', { name: /Lanas del Limay/ }).click();
  const docs = page.getByRole('region', { name: 'Documentos' });
  await expect(docs.getByTestId('exhibitor-document')).toHaveCount(2);

  await docs.getByRole('button', { name: 'Aprobar constancia.pdf' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('¿Aprobar constancia.pdf?');
  await page.getByRole('button', { name: 'Sí, aprobar' }).click();
  await expect(docs.getByText('Aprobaste constancia.pdf.')).toBeVisible();

  await docs.getByRole('button', { name: 'Rechazar seguro.pdf' }).click();
  await page.getByRole('button', { name: 'Sí, rechazar' }).click();
  await expect(page.getByText('Escribí el motivo')).toBeVisible();
  await page.getByLabel('Motivo del rechazo').fill('La póliza está vencida');
  await page.getByRole('button', { name: 'Sí, rechazar' }).click();
  await expect(docs.getByText('Motivo: La póliza está vencida')).toBeVisible();

  expect(
    api.requests.filter((r) => r.path.endsWith('/review')).map((r) => [r.path, r.body]),
  ).toEqual([
    ['/exhibitors/x1/documents/doc1/review', { decision: 'APPROVED' }],
    [
      '/exhibitors/x1/documents/doc2/review',
      { decision: 'REJECTED', reason: 'La póliza está vencida' },
    ],
  ]);
  // The list refreshed: the exhibitor's documentation status is now the rejection.
  await expect(page.getByRole('button', { name: /Lanas del Limay/ })).toContainText('Rechazada');

  const download = page.waitForRequest((r) => r.url().startsWith('https://storage.test/download/'));
  await docs.getByRole('button', { name: 'Descargar constancia.pdf' }).click();
  await download;
  expect(await seriousViolations(page)).toEqual([]);
});

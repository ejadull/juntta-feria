import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { EXTERNAL_NAVIGATION } from '../../shared/external-navigation';
import {
  FileUploader,
  OwnDocumentsRepository,
  type ExhibitorDocumentDto,
} from './data/document.repository';
import { InMemoryDocuments, InMemoryFileUploader } from './data/in-memory-documents.repository';
import { MyDocumentsPage } from './my-documents.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const doc = (patch: Partial<ExhibitorDocumentDto> = {}): ExhibitorDocumentDto => ({
  id: 'd1',
  exhibitorId: 'me',
  type: 'SEGURO',
  status: 'PENDING',
  fileName: 'seguro.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  uploadedAt: '2026-11-09T12:00:00Z',
  reviewedAt: null,
  rejectionReason: null,
  createdAt: '2026-11-09T12:00:00Z',
  ...patch,
});

const pdf = (name = 'constancia.pdf', type = 'application/pdf', size = 2048) =>
  new File([new Uint8Array(size)], name, { type });

async function render(seed: readonly ExhibitorDocumentDto[] = []) {
  const store = new InMemoryDocuments(seed);
  const uploader = new InMemoryFileUploader();
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: OwnDocumentsRepository, useValue: store.own },
      { provide: FileUploader, useValue: uploader },
      { provide: EXTERNAL_NAVIGATION, useValue: navigate },
    ],
  });
  const fixture = TestBed.createComponent(MyDocumentsPage);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find(
      (b) => plain(b.textContent).includes(label) || b.getAttribute('aria-label') === label,
    )!;
  const click = async (label: string) => {
    button(label).click();
    await fixture.whenStable();
  };
  const choose = async (file: File) => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  const rows = () =>
    [...host.querySelectorAll('[data-testid="document-row"]')].map((r) => plain(r.textContent));
  return { host, click, choose, rows, store, uploader, navigate, fixture };
}

describe('MyDocumentsPage (EXH-03, feriante)', () => {
  it('explains the empty state and the accepted files', async () => {
    const { host } = await render();
    expect(plain(host.querySelector('h1')?.textContent)).toBe('Mis documentos');
    expect(host.querySelector('[data-testid="no-documents"]')?.textContent).toContain(
      'Todavía no subiste documentos',
    );
    expect(plain(host.textContent)).toContain('PDF, JPG o PNG de hasta 10 MB');
  });

  it('lists documents with status as icon and text, and the rejection reason', async () => {
    const { rows } = await render([
      doc(),
      doc({
        id: 'd2',
        type: 'OTRO',
        fileName: 'otro.png',
        status: 'REJECTED',
        rejectionReason: 'Se ve borroso',
      }),
      doc({ id: 'd3', status: 'APPROVED', fileName: 'ok.pdf' }),
    ]);
    expect(rows()[0]).toContain('En revisión');
    expect(rows()[1]).toContain('Rechazado');
    expect(rows()[1]).toContain('Motivo del rechazo: Se ve borroso');
    expect(rows()[2]).toContain('Aprobado');
  });

  it('refuses a file of another type or over 10 MB before sending anything', async () => {
    const { host, choose, click, uploader, store } = await render();
    await choose(pdf('virus.exe', 'application/x-msdownload'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('PDF, JPG o PNG');
    expect(host.querySelector('input[type="file"]')?.getAttribute('aria-invalid')).toBe('true');
    await click('Subir documento');
    expect(uploader.sent).toHaveLength(0);

    await choose(pdf('enorme.pdf', 'application/pdf', 10 * 1024 * 1024 + 1));
    expect(host.textContent).toContain('el máximo es 10 MB');
    await click('Subir documento');
    expect(uploader.sent).toHaveLength(0);
    expect(store.all()).toHaveLength(0);
  });

  it('asks for a file when none was chosen', async () => {
    const { host, click } = await render();
    await click('Subir documento');
    expect(host.textContent).toContain('Elegí el archivo que querés subir.');
  });

  it('uploads: asks for the ticket, PUTs the file to the signed URL and confirms', async () => {
    const { host, choose, click, uploader, rows, store } = await render();
    await choose(pdf('constancia.pdf'));
    await click('Subir documento');
    expect(uploader.sent).toEqual([
      expect.objectContaining({
        url: 'https://storage.test/upload/doc-1',
        headers: { 'Content-Type': 'application/pdf' },
        size: 2048,
      }),
    ]);
    expect(store.all()).toHaveLength(1);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Subimos el documento');
    expect(rows()[0]).toContain('constancia.pdf');
    expect(host.querySelector('[data-testid="upload-progress"]')).toBeNull();
  });

  it('keeps the form and explains when the storage rejects the PUT', async () => {
    const { host, choose, click, uploader, rows } = await render();
    uploader.failWith = new HttpErrorResponse({ status: 403 });
    await choose(pdf());
    await click('Subir documento');
    expect(host.textContent).toContain('No pudimos enviar el archivo');
    expect(rows()).toHaveLength(0);
  });

  it('downloads through the signed URL of the API', async () => {
    const { click, navigate } = await render([doc()]);
    await click('Descargar seguro.pdf');
    expect(navigate).toHaveBeenCalledWith('https://storage.test/download/d1');
  });

  it('confirms in the page before deleting, and does not offer it for an approved document', async () => {
    const { host, click, rows } = await render([
      doc(),
      doc({ id: 'd2', status: 'APPROVED', fileName: 'ok.pdf' }),
    ]);
    expect(host.querySelector('[aria-label="Eliminar ok.pdf"]')).toBeNull();
    await click('Eliminar seguro.pdf');
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain(
      '¿Eliminar seguro.pdf?',
    );
    await click('Cancelar');
    expect(rows()).toHaveLength(2);
    await click('Eliminar seguro.pdf');
    await click('Sí, eliminar');
    expect(rows()).toHaveLength(1);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Eliminamos');
  });
});

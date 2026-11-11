import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EXTERNAL_NAVIGATION } from '../../../shared/external-navigation';
import {
  DocumentReviewRepository,
  type ExhibitorDocumentDto,
} from '../../documents/data/document.repository';
import { InMemoryDocuments } from '../../documents/data/in-memory-documents.repository';
import { ExhibitorDocuments } from './exhibitor-documents';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const doc = (patch: Partial<ExhibitorDocumentDto> = {}): ExhibitorDocumentDto => ({
  id: 'd1',
  exhibitorId: 'e1',
  type: 'CONSTANCIA_AFIP',
  status: 'PENDING',
  fileName: 'constancia.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  uploadedAt: '2026-11-09T12:00:00Z',
  reviewedAt: null,
  rejectionReason: null,
  createdAt: '2026-11-09T12:00:00Z',
  ...patch,
});

@Component({
  imports: [ExhibitorDocuments],
  template: `<app-exhibitor-documents [exhibitorId]="id" (reviewed)="reviewed = reviewed + 1" />`,
})
class Host {
  id = 'e1';
  reviewed = 0;
}

async function render(seed: readonly ExhibitorDocumentDto[] = []) {
  const store = new InMemoryDocuments(seed);
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: DocumentReviewRepository, useValue: store.review },
      { provide: EXTERNAL_NAVIGATION, useValue: navigate },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const click = async (label: string) => {
    [...host.querySelectorAll('button')]
      .find((b) => plain(b.textContent) === label || b.getAttribute('aria-label') === label)!
      .click();
    await fixture.whenStable();
  };
  const rows = () =>
    [...host.querySelectorAll('[data-testid="exhibitor-document"]')].map((r) =>
      plain(r.textContent),
    );
  return { host, fixture, click, rows, navigate, store };
}

describe('ExhibitorDocuments (EXH-03, organizador)', () => {
  it('says when the exhibitor uploaded nothing', async () => {
    const { host } = await render();
    expect(host.querySelector('[data-testid="no-exhibitor-documents"]')).not.toBeNull();
  });

  it('lists the documents with status and downloads through the signed URL', async () => {
    const { rows, click, navigate } = await render([doc()]);
    expect(rows()[0]).toContain('Constancia de AFIP');
    expect(rows()[0]).toContain('En revisión');
    await click('Descargar constancia.pdf');
    expect(navigate).toHaveBeenCalledWith('https://storage.test/download/d1');
  });

  it('approves only after an in-page confirmation, and tells the page it changed', async () => {
    const { host, fixture, click, rows } = await render([doc()]);
    await click('Aprobar constancia.pdf');
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain(
      '¿Aprobar constancia.pdf?',
    );
    await click('Cancelar');
    expect(rows()[0]).toContain('En revisión');
    await click('Aprobar constancia.pdf');
    await click('Sí, aprobar');
    expect(rows()[0]).toContain('Aprobado');
    expect(fixture.componentInstance.reviewed).toBe(1);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Aprobaste');
  });

  it('requires a reason to reject, then shows it', async () => {
    const { host, fixture, click, rows, store } = await render([doc()]);
    await click('Rechazar constancia.pdf');
    await click('Sí, rechazar');
    expect(host.querySelector('#review-reason-error')?.textContent).toContain('Escribí el motivo');
    expect(store.all()[0].status).toBe('PENDING');

    const reason = host.querySelector('textarea')!;
    reason.value = 'Está vencida';
    reason.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    await click('Sí, rechazar');
    expect(store.all()[0]).toMatchObject({ status: 'REJECTED', rejectionReason: 'Está vencida' });
    expect(rows()[0]).toContain('Rechazado');
    expect(rows()[0]).toContain('Motivo: Está vencida');
    expect(fixture.componentInstance.reviewed).toBe(1);
  });
});

import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { DocumentsStatus, ExhibitorSummaryDto } from '../data/exhibitor.repository';
import { ExhibitorDocuments } from './exhibitor-documents';

/** Icon + text, never color only (§8 UX). */
export const DOCUMENTS_STATUS: Readonly<
  Record<DocumentsStatus, { label: string; icon: string; tone: string }>
> = {
  APPROVED: { label: 'Aprobada', icon: '✓', tone: 'bg-primary/10 text-primary-strong' },
  PENDING: { label: 'Pendiente', icon: '◔', tone: 'bg-reserved/15 text-text' },
  REJECTED: { label: 'Rechazada', icon: '✕', tone: 'bg-danger/10 text-text' },
  MISSING: { label: 'Sin documentación', icon: '○', tone: 'bg-surface-soft text-text-muted' },
};

/** Organizer-only record: includes private data (INV-08). */
@Component({
  selector: 'app-exhibitor-detail',
  imports: [ExhibitorDocuments],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (exhibitor(); as e) {
      <h2 class="text-xl font-semibold">{{ e.tradeName }}</h2>
      <p class="text-sm text-text-muted">{{ e.category ?? 'Sin rubro' }}</p>
      <p class="mt-3 text-sm text-text">{{ e.description }}</p>

      <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt class="text-text-muted">Razón social</dt>
        <dd>{{ e.legalName }}</dd>
        <dt class="text-text-muted">CUIT</dt>
        <dd class="tabular-nums">{{ e.taxId ?? 'Sin CUIT cargado' }}</dd>
        <dt class="text-text-muted">Rubro</dt>
        <dd>{{ e.category ?? 'Sin rubro' }}</dd>
        <dt class="text-text-muted">Contacto público</dt>
        <dd>
          {{
            e.publicContactOptIn
              ? 'Sí: el directorio público puede mostrar su contacto'
              : 'No: el directorio público no muestra su contacto'
          }}
        </dd>
        <dt class="text-text-muted">Documentación</dt>
        <dd>
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
            [class]="status(e).tone"
          >
            <span aria-hidden="true">{{ status(e).icon }}</span> {{ status(e).label }}
          </span>
        </dd>
      </dl>
      <app-exhibitor-documents [exhibitorId]="e.id" (reviewed)="reviewed.emit()" />
      <p class="mt-4 text-xs text-text-muted">
        Datos privados: solo visibles para la organización.
      </p>
    } @else {
      <p class="text-sm text-text-muted">Seleccioná un expositor para ver su ficha.</p>
    }
  `,
})
export class ExhibitorDetail {
  readonly exhibitor = input<ExhibitorSummaryDto | null>(null);
  /** A document was approved or rejected: the exhibitor's documentation status changed. */
  readonly reviewed = output<void>();

  protected status(e: ExhibitorSummaryDto) {
    return DOCUMENTS_STATUS[e.documentsStatus];
  }
}

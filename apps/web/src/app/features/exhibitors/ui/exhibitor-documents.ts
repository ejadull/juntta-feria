import { DatePipe } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { messageFor } from '../../../shared/auth/problem';
import { EXTERNAL_NAVIGATION } from '../../../shared/external-navigation';
import { valueOf } from '../../../shared/forms';
import {
  DocumentReviewRepository,
  type ExhibitorDocumentDto,
} from '../../documents/data/document.repository';
import { DOCUMENT_STATUS, DOCUMENT_TYPE_LABEL, formatBytes } from '../../documents/rules';

const LOAD_FAILED = 'No pudimos cargar los documentos. Probá de nuevo en unos minutos.';
const DOWNLOAD_FAILED = 'No pudimos preparar la descarga. Probá de nuevo.';
const REVIEW_FAILED = 'No pudimos guardar la revisión. Probá de nuevo en unos minutos.';
const NEEDS_REASON = 'Escribí el motivo: el feriante lo ve para saber qué corregir.';

interface Decision {
  readonly document: ExhibitorDocumentDto;
  readonly kind: 'APPROVED' | 'REJECTED';
}

/** EXH-03 (organizer side): documents of one exhibitor, with download and review. */
@Component({
  selector: 'app-exhibitor-documents',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mt-6 border-t border-border pt-4" aria-labelledby="exhibitor-docs-heading">
      <h3 id="exhibitor-docs-heading" class="text-base font-semibold">Documentos</h3>

      @if (notice(); as message) {
        <p role="status" class="mt-2 rounded-lg bg-available/15 p-2 text-sm text-text">
          {{ message }}
        </p>
      }
      @if (actionError(); as message) {
        <p role="alert" class="mt-2 rounded-lg bg-danger/10 p-2 text-sm text-text">{{ message }}</p>
      }

      @if (loadError(); as message) {
        <p role="alert" class="mt-2 text-sm text-text">{{ message }}</p>
      } @else if (list(); as rows) {
        @if (rows.length === 0) {
          <p class="mt-2 text-sm text-text-muted" data-testid="no-exhibitor-documents">
            Este expositor todavía no subió documentos.
          </p>
        } @else {
          <ul class="mt-2 grid gap-3">
            @for (d of rows; track d.id) {
              <li
                class="rounded-lg border border-border p-3 text-sm"
                data-testid="exhibitor-document"
              >
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="font-medium">{{ typeLabel[d.type] }}</p>
                    <p class="truncate text-xs text-text-muted">
                      {{ d.fileName }} · {{ size(d) }} · {{ d.uploadedAt | date: 'dd/MM/yyyy' }}
                    </p>
                  </div>
                  <span
                    class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs"
                    [class]="statusInfo[d.status].tone"
                  >
                    <span aria-hidden="true">{{ statusInfo[d.status].icon }}</span>
                    {{ statusInfo[d.status].label }}
                  </span>
                </div>
                @if (d.status === 'REJECTED' && d.rejectionReason) {
                  <p class="mt-2 text-xs text-text-muted">Motivo: {{ d.rejectionReason }}</p>
                }
                <div class="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn"
                    [attr.aria-label]="'Descargar ' + d.fileName"
                    (click)="download(d)"
                  >
                    Descargar
                  </button>
                  @if (d.status !== 'APPROVED') {
                    <button
                      type="button"
                      class="btn btn-primary"
                      [attr.aria-label]="'Aprobar ' + d.fileName"
                      (click)="ask(d, 'APPROVED')"
                    >
                      Aprobar
                    </button>
                  }
                  @if (d.status !== 'REJECTED') {
                    <button
                      type="button"
                      class="btn btn-danger"
                      [attr.aria-label]="'Rechazar ' + d.fileName"
                      (click)="ask(d, 'REJECTED')"
                    >
                      Rechazar
                    </button>
                  }
                </div>
              </li>
            }
          </ul>
        }
      } @else {
        <p class="mt-2 text-sm text-text-muted" aria-live="polite">Cargando documentos…</p>
      }

      @if (deciding(); as target) {
        <div
          role="alertdialog"
          aria-labelledby="review-title"
          aria-describedby="review-text"
          class="card mt-3 border-border-strong"
        >
          <p id="review-title" class="font-semibold">
            {{ target.kind === 'APPROVED' ? '¿Aprobar' : '¿Rechazar' }}
            {{ target.document.fileName }}?
          </p>
          <p id="review-text" class="mt-1 text-sm text-text-muted">
            {{
              target.kind === 'APPROVED'
                ? 'El feriante ve que su documento quedó aprobado.'
                : 'El feriante ve el motivo y puede subir uno nuevo.'
            }}
          </p>
          @if (target.kind === 'REJECTED') {
            <label class="mt-3 grid gap-1 text-sm">
              <span>Motivo del rechazo</span>
              <textarea
                #reasonField
                class="field"
                rows="3"
                maxlength="500"
                [attr.aria-invalid]="reasonError() ? 'true' : null"
                [attr.aria-describedby]="reasonError() ? 'review-reason-error' : null"
                [value]="reason()"
                (input)="reason.set(valueOf($event))"
              ></textarea>
              @if (reasonError(); as message) {
                <span id="review-reason-error" class="text-danger">{{ message }}</span>
              }
            </label>
          }
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn"
              [class.btn-primary]="target.kind === 'APPROVED'"
              [class.btn-danger]="target.kind === 'REJECTED'"
              [disabled]="busy()"
              (click)="confirmDecision(target)"
            >
              {{ target.kind === 'APPROVED' ? 'Sí, aprobar' : 'Sí, rechazar' }}
            </button>
            <button #cancel type="button" class="btn" (click)="deciding.set(null)">Cancelar</button>
          </div>
        </div>
      }
    </section>
  `,
})
export class ExhibitorDocuments {
  private readonly repository = inject(DocumentReviewRepository);
  private readonly navigate = inject(EXTERNAL_NAVIGATION);
  private readonly injector = inject(Injector);
  private readonly cancel = viewChild<ElementRef<HTMLButtonElement>>('cancel');
  private readonly reasonField = viewChild<ElementRef<HTMLTextAreaElement>>('reasonField');

  readonly exhibitorId = input.required<string>();
  /** A review changed the exhibitor's documentation status: the list above should refresh. */
  readonly reviewed = output<void>();

  protected readonly typeLabel = DOCUMENT_TYPE_LABEL;
  protected readonly statusInfo = DOCUMENT_STATUS;
  protected readonly valueOf = valueOf;

  protected readonly list = signal<readonly ExhibitorDocumentDto[] | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly notice = signal('');
  protected readonly busy = signal(false);
  protected readonly deciding = signal<Decision | null>(null);
  protected readonly reason = signal('');
  protected readonly reasonError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.exhibitorId();
      untracked(() => {
        this.list.set(null);
        this.deciding.set(null);
        this.notice.set('');
        this.actionError.set(null);
        this.load(id);
      });
    });
  }

  protected size(d: ExhibitorDocumentDto): string {
    return d.sizeBytes === null ? '' : formatBytes(d.sizeBytes);
  }

  protected download(document: ExhibitorDocumentDto): void {
    this.actionError.set(null);
    this.repository.download(this.exhibitorId(), document.id).subscribe({
      next: (ticket) => this.navigate(ticket.url),
      error: () => this.actionError.set(DOWNLOAD_FAILED),
    });
  }

  protected ask(document: ExhibitorDocumentDto, kind: Decision['kind']): void {
    this.reason.set('');
    this.reasonError.set(null);
    this.deciding.set({ document, kind });
    afterNextRender(() => (this.reasonField() ?? this.cancel())?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected confirmDecision(target: Decision): void {
    const reason = this.reason().trim();
    if (target.kind === 'REJECTED' && !reason) {
      this.reasonError.set(NEEDS_REASON);
      this.reasonField()?.nativeElement.focus();
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    this.repository
      .review(
        this.exhibitorId(),
        target.document.id,
        target.kind === 'APPROVED' ? { decision: 'APPROVED' } : { decision: 'REJECTED', reason },
      )
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.deciding.set(null);
          this.notice.set(
            target.kind === 'APPROVED'
              ? `Aprobaste ${target.document.fileName}.`
              : `Rechazaste ${target.document.fileName}.`,
          );
          this.load(this.exhibitorId());
          this.reviewed.emit();
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.actionError.set(messageFor(error, {}, {}, REVIEW_FAILED));
        },
      });
  }

  private load(exhibitorId: string): void {
    this.repository.list(exhibitorId).subscribe({
      next: (rows) => {
        this.loadError.set(null);
        this.list.set(rows);
      },
      error: () => this.loadError.set(LOAD_FAILED),
    });
  }
}

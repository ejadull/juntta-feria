import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { last, switchMap, tap } from 'rxjs';
import { EXTERNAL_NAVIGATION } from '../../shared/external-navigation';
import { messageFor } from '../../shared/auth/problem';
import { valueOf } from '../../shared/forms';
import {
  FileUploader,
  OwnDocumentsRepository,
  type DocumentType,
  type ExhibitorDocumentDto,
} from './data/document.repository';
import {
  ACCEPT_ATTRIBUTE,
  DOCUMENT_STATUS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABEL,
  fileProblem,
  formatBytes,
  MAX_DOCUMENT_BYTES,
} from './rules';

const LOAD_FAILED = 'No pudimos cargar tus documentos. Probá de nuevo en unos minutos.';
const UPLOAD_FAILED = 'No pudimos subir el documento. Probá de nuevo en unos minutos.';
const SEND_FAILED =
  'No pudimos enviar el archivo. Revisá tu conexión y probá de nuevo; el link de subida dura 5 minutos.';
const DOWNLOAD_FAILED = 'No pudimos preparar la descarga. Probá de nuevo.';
const REMOVE_FAILED = 'No pudimos eliminar el documento. Probá de nuevo.';
const BY_CODE = {
  UPLOAD_MISSING: 'El archivo no llegó. Probá subirlo de nuevo.',
  UPLOAD_REJECTED: 'El archivo no cumple el tipo o el tamaño permitido, así que no se guardó.',
  DOCUMENT_APPROVED: 'Un documento aprobado no se puede eliminar.',
};

/** EXH-03 (exhibitor): the documentation the organization asks for, uploaded straight to private storage. */
@Component({
  selector: 'app-my-documents-page',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      <header>
        <p class="text-sm font-semibold tracking-wider text-primary-strong">FERIANTE</p>
        <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Mis documentos</h1>
        <p class="mt-2 text-text-muted">
          Subí la documentación que te pide la organización. Solo la ve la organización: nunca se
          publica. Aceptamos PDF, JPG o PNG de hasta {{ maxSize }}.
        </p>
      </header>

      <form
        class="card mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        novalidate
        (submit)="submit($event)"
      >
        <label class="grid gap-1 text-sm">
          <span>Tipo de documento</span>
          <select class="field" (change)="type.set($any(valueOf($event)))">
            @for (t of types; track t) {
              <option [value]="t" [selected]="t === type()">{{ typeLabel[t] }}</option>
            }
          </select>
        </label>

        <label class="grid gap-1 text-sm">
          <span>Archivo</span>
          <input
            #fileInput
            class="field"
            type="file"
            [accept]="accept"
            [attr.aria-invalid]="fileError() ? 'true' : null"
            [attr.aria-describedby]="fileError() ? 'document-file-error' : null"
            (change)="pick($event)"
          />
        </label>
        @if (fileError(); as message) {
          <p id="document-file-error" role="alert" class="text-sm text-danger sm:col-span-2">
            {{ message }}
          </p>
        }

        @if (progress() !== null) {
          <div class="sm:col-span-2" data-testid="upload-progress">
            <label class="text-sm" for="upload-progress-bar">Subiendo… {{ progress() }} %</label>
            <progress
              id="upload-progress-bar"
              class="mt-1 block w-full"
              max="100"
              [value]="progress()"
            >
              {{ progress() }} %
            </progress>
          </div>
        }
        @if (formError(); as message) {
          <p role="alert" class="rounded-lg bg-danger/10 p-3 text-sm text-text sm:col-span-2">
            {{ message }}
          </p>
        }

        <div class="sm:col-span-2">
          <button type="submit" class="btn btn-primary" [disabled]="busy()">Subir documento</button>
        </div>
      </form>

      @if (notice(); as message) {
        <p role="status" class="mt-4 rounded-lg bg-available/15 p-3 text-sm text-text">
          {{ message }}
        </p>
      }
      @if (actionError(); as message) {
        <p role="alert" class="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-text">{{ message }}</p>
      }

      @if (listError(); as message) {
        <p role="alert" class="mt-6 rounded-xl bg-danger/10 p-4 text-text">{{ message }}</p>
      } @else if (list(); as rows) {
        @if (rows.length === 0) {
          <div class="card mt-6" data-testid="no-documents">
            <p class="font-semibold">Todavía no subiste documentos</p>
            <p class="mt-1 text-sm text-text-muted">
              Cuando subas uno, la organización lo revisa y acá ves si lo aprobó o qué corregir.
            </p>
          </div>
        } @else {
          <ul class="mt-6 grid gap-3" aria-label="Documentos subidos">
            @for (d of rows; track d.id) {
              <li class="card" data-testid="document-row">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="font-semibold">{{ typeLabel[d.type] }}</p>
                    <p class="truncate text-sm text-text-muted">
                      {{ d.fileName }} · {{ size(d) }} · subido el
                      {{ d.uploadedAt | date: 'dd/MM/yyyy' }}
                    </p>
                  </div>
                  <span
                    class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-sm"
                    [class]="statusInfo[d.status].tone"
                  >
                    <span aria-hidden="true">{{ statusInfo[d.status].icon }}</span>
                    {{ statusInfo[d.status].label }}
                  </span>
                </div>
                @if (d.status === 'REJECTED' && d.rejectionReason) {
                  <p class="mt-3 rounded-lg bg-danger/10 p-3 text-sm text-text">
                    <strong>Motivo del rechazo:</strong> {{ d.rejectionReason }}
                  </p>
                }
                <div class="mt-3 flex flex-wrap gap-2">
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
                      class="btn btn-danger"
                      [attr.aria-label]="'Eliminar ' + d.fileName"
                      (click)="askRemove(d)"
                    >
                      Eliminar
                    </button>
                  }
                </div>
              </li>
            }
          </ul>
        }
      } @else {
        <p class="mt-6 text-text-muted" aria-live="polite">Cargando documentos…</p>
      }

      @if (removing(); as target) {
        <div
          role="alertdialog"
          aria-labelledby="document-remove-title"
          aria-describedby="document-remove-text"
          class="card mt-4 border-border-strong"
        >
          <p id="document-remove-title" class="font-semibold">¿Eliminar {{ target.fileName }}?</p>
          <p id="document-remove-text" class="mt-1 text-sm text-text-muted">
            Se borra el archivo. Después podés subir uno nuevo.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-danger"
              [disabled]="busy()"
              (click)="remove(target)"
            >
              Sí, eliminar
            </button>
            <button #cancel type="button" class="btn" (click)="removing.set(null)">Cancelar</button>
          </div>
        </div>
      }
    </div>
  `,
})
export class MyDocumentsPage {
  private readonly repository = inject(OwnDocumentsRepository);
  private readonly uploader = inject(FileUploader);
  private readonly navigate = inject(EXTERNAL_NAVIGATION);
  private readonly injector = inject(Injector);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  private readonly cancel = viewChild<ElementRef<HTMLButtonElement>>('cancel');

  protected readonly types = DOCUMENT_TYPES;
  protected readonly typeLabel = DOCUMENT_TYPE_LABEL;
  protected readonly statusInfo = DOCUMENT_STATUS;
  protected readonly accept = ACCEPT_ATTRIBUTE;
  protected readonly maxSize = formatBytes(MAX_DOCUMENT_BYTES);
  protected readonly valueOf = valueOf;

  protected readonly list = signal<readonly ExhibitorDocumentDto[] | null>(null);
  protected readonly listError = signal<string | null>(null);
  protected readonly type = signal<DocumentType>('CONSTANCIA_AFIP');
  protected readonly file = signal<File | null>(null);
  protected readonly fileError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly notice = signal('');
  protected readonly progress = signal<number | null>(null);
  protected readonly busy = signal(false);
  protected readonly removing = signal<ExhibitorDocumentDto | null>(null);

  constructor() {
    this.load();
  }

  protected size(d: ExhibitorDocumentDto): string {
    return d.sizeBytes === null ? '' : formatBytes(d.sizeBytes);
  }

  protected pick(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.file.set(file);
    this.fileError.set(file ? fileProblem(file) : null);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const file = this.file();
    const problem = file ? fileProblem(file) : 'Elegí el archivo que querés subir.';
    this.fileError.set(problem);
    if (!file || problem) {
      afterNextRender(() => this.fileInput()?.nativeElement.focus(), { injector: this.injector });
      return;
    }
    this.busy.set(true);
    this.progress.set(0);
    this.formError.set(null);
    this.notice.set('');
    let sending = false;
    this.repository
      .requestUpload({
        type: this.type(),
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      })
      .pipe(
        switchMap((ticket) => {
          sending = true;
          return this.uploader.put(ticket.upload, file).pipe(
            tap((percent) => this.progress.set(percent)),
            last(),
            tap(() => (sending = false)),
            switchMap(() => this.repository.complete(ticket.document.id)),
          );
        }),
      )
      .subscribe({
        next: () => {
          this.finishUpload();
          this.notice.set('Subimos el documento. La organización lo va a revisar.');
          this.load();
        },
        error: (error: unknown) => {
          this.finishUpload(false);
          this.formError.set(sending ? SEND_FAILED : messageFor(error, BY_CODE, {}, UPLOAD_FAILED));
        },
      });
  }

  protected download(document: ExhibitorDocumentDto): void {
    this.actionError.set(null);
    this.repository.download(document.id).subscribe({
      next: (ticket) => this.navigate(ticket.url),
      error: () => this.actionError.set(DOWNLOAD_FAILED),
    });
  }

  protected askRemove(document: ExhibitorDocumentDto): void {
    this.removing.set(document);
    afterNextRender(() => this.cancel()?.nativeElement.focus(), { injector: this.injector });
  }

  protected remove(document: ExhibitorDocumentDto): void {
    this.busy.set(true);
    this.repository.remove(document.id).subscribe({
      next: () => this.afterRemove('Eliminamos el documento.', null),
      error: (error: unknown) =>
        this.afterRemove('', messageFor(error, BY_CODE, {}, REMOVE_FAILED)),
    });
  }

  private afterRemove(notice: string, problem: string | null): void {
    this.busy.set(false);
    this.removing.set(null);
    this.notice.set(notice);
    this.actionError.set(problem);
    this.load();
  }

  private finishUpload(clear = true): void {
    this.busy.set(false);
    this.progress.set(null);
    if (!clear) return;
    this.file.set(null);
    const input = this.fileInput()?.nativeElement;
    if (input) input.value = '';
  }

  private load(): void {
    this.repository.list().subscribe({
      next: (rows) => {
        this.listError.set(null);
        this.list.set(rows);
      },
      error: () => this.listError.set(LOAD_FAILED),
    });
  }
}

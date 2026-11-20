import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { firstValueFrom, lastValueFrom, tap } from 'rxjs';
import { messageFor } from '../../../shared/auth/problem';
import { valueOf } from '../../../shared/forms';
import { FileUploader } from '../../documents/data/document.repository';
import {
  ExhibitorPhotosRepository,
  VIDEO_TYPES,
  type ExhibitorEventOption,
  type ExhibitorPhotoDto,
  type PhotoContentType,
} from '../data/exhibitor-photos.repository';
import {
  MAX_CAPTION_LENGTH,
  MAX_PUBLICATIONS_PER_EVENT,
  MAX_VIDEO_BYTES,
  canPublishInEvent,
  publicationProblem,
} from '../domain/publication-rules';

const LOAD_FAILED = 'No pudimos cargar tus publicaciones. Probá de nuevo en unos minutos.';
const UPLOAD_FAILED = 'No pudimos subir la publicación. Probá de nuevo en unos minutos.';
const SAVE_FAILED = 'No pudimos guardar el texto. Probá de nuevo en unos minutos.';
const REMOVE_FAILED = 'No pudimos eliminar la publicación. Probá de nuevo en unos minutos.';
const EMPTY_CAPTION = 'Escribí el texto o dejá la publicación sin cambios.';
const BY_CODE: Readonly<Record<string, string>> = {
  PUBLICATION_LIMIT: `Ya tenés ${MAX_PUBLICATIONS_PER_EVENT} publicaciones en esta feria. Eliminá alguna para subir otra.`,
  NO_STAND_IN_EVENT: 'Solo podés publicar en una feria donde tengas un stand confirmado.',
  EVENT_CLOSED: 'Esta feria ya terminó: no se pueden agregar ni editar publicaciones.',
  UPLOAD_MISSING: 'El archivo no llegó. Probá subirlo de nuevo.',
  UPLOAD_REJECTED:
    'El archivo no cumple las reglas de publicación (formato, tamaño, duración o texto), así que no se guardó.',
};

const isSupportedVideo = (type: string): boolean =>
  (VIDEO_TYPES as readonly string[]).includes(type);

/** Reads the length of a local video in whole seconds (rounded up); null if the browser cannot. */
function readVideoDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (seconds: number | null): void => {
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? Math.ceil(video.duration) : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

/**
 * Publications of the signed-in exhibitor: photos or videos about one of the events where it holds
 * a stand. Upload goes browser -> storage; the API registers, confirms and enforces the same rules
 * (change exh-media-share, MED-06).
 */
@Component({
  selector: 'app-exhibitor-publications-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card mt-6 grid gap-4" aria-labelledby="publications-title">
      <header>
        <h2 id="publications-title" class="text-xl font-semibold">Publicaciones</h2>
        <p class="mt-1 text-sm text-text-muted">
          Fotos o videos de tu producto para una feria donde tengas stand. Se muestran a los
          visitantes cuando tocan tu stand, y cada una se puede compartir. Imágenes JPG, PNG o WebP
          de hasta 5 MB; videos MP4 H.264 o WebM de hasta 50 MB y 60 segundos.
        </p>
        @if (!isPublic()) {
          <p class="mt-2 rounded-lg bg-primary/10 p-3 text-sm" data-testid="pub-private">
            Tus publicaciones no se muestran al público hasta que aceptes aparecer en el directorio
            público (en tu perfil, más arriba).
          </p>
        }
      </header>

      @if (loadError(); as message) {
        <p role="alert" class="text-danger">{{ message }}</p>
      } @else if (!hasEvents()) {
        <p class="text-sm text-text-muted" data-testid="pub-no-events">
          Necesitás un stand confirmado en una feria para publicar.
        </p>
      } @else {
        <label class="grid gap-1 text-sm">
          <span>Feria</span>
          <select id="pub-event" class="field" [disabled]="busy()" (change)="chooseEvent($event)">
            @for (e of events(); track e.id) {
              <option [value]="e.id" [selected]="e.id === eventId()">{{ e.name }}</option>
            }
          </select>
        </label>

        <label class="grid gap-1 text-sm">
          <span>Texto de la publicación (opcional)</span>
          <input
            id="pub-caption"
            class="field"
            type="text"
            maxlength="200"
            autocomplete="off"
            [value]="caption()"
            (input)="caption.set(valueOf($event))"
          />
        </label>

        <div class="grid gap-1 text-sm">
          <label for="pub-file">
            Agregar foto o video
            <span class="text-text-muted" data-testid="pub-count">
              (Publicaciones en esta feria: {{ inEvent().length }} de {{ maxPublications }})
            </span>
          </label>
          <input
            id="pub-file"
            class="field file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            [disabled]="busy() || full() || !eventId()"
            [attr.aria-invalid]="error() ? 'true' : null"
            [attr.aria-describedby]="error() ? 'pub-error' : null"
            (change)="onFile($event)"
          />
          @if (full()) {
            <span class="text-xs text-text-muted">
              Llegaste al máximo de {{ maxPublications }} publicaciones en esta feria.
            </span>
          }
          @if (busy()) {
            <progress class="w-full" [value]="progress()" max="100" aria-label="Progreso de la subida">
              {{ progress() }}%
            </progress>
          }
          @if (error(); as message) {
            <span id="pub-error" role="alert" class="text-danger" data-testid="pub-error">
              {{ message }}
            </span>
          }
          @if (status(); as message) {
            <span role="status" class="text-text-muted">{{ message }}</span>
          }
        </div>

        @if (inEvent().length > 0) {
          <ul class="grid gap-3 sm:grid-cols-2" aria-label="Publicaciones de la feria elegida">
            @for (p of inEvent(); track p.id; let i = $index) {
              <li class="grid gap-2 rounded-lg border border-border p-3" data-testid="pub-item">
                @if (p.kind === 'VIDEO') {
                  <video
                    class="aspect-video w-full rounded-lg bg-surface-soft"
                    [src]="p.url"
                    controls
                    preload="metadata"
                    [attr.aria-label]="'Video ' + (i + 1) + ' de tu stand'"
                  ></video>
                } @else {
                  <img
                    class="aspect-[4/3] w-full rounded-lg border border-border object-cover"
                    [src]="p.url"
                    [alt]="p.caption || 'Foto ' + (i + 1) + ' de tu stand'"
                    width="400"
                    height="300"
                    loading="lazy"
                    decoding="async"
                  />
                }
                @if (p.status === 'HIDDEN') {
                  <p class="text-xs font-semibold" data-testid="pub-hidden">
                    Oculta por el organizador: no se ve en el plano ni al compartir.
                  </p>
                }
                <p class="text-sm">{{ p.caption || 'Sin texto' }}</p>
                <label class="grid gap-1 text-xs">
                  <span>Editar texto</span>
                  <input
                    class="field"
                    type="text"
                    maxlength="200"
                    autocomplete="off"
                    [value]="draftOf(p)"
                    (input)="setDraft(p.id, valueOf($event))"
                  />
                </label>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn"
                    data-testid="pub-save"
                    [disabled]="busy()"
                    (click)="saveCaption(p)"
                  >
                    Guardar texto
                  </button>
                  <button
                    type="button"
                    class="btn"
                    data-testid="pub-delete"
                    [disabled]="busy()"
                    [attr.aria-label]="'Eliminar publicación ' + (i + 1)"
                    (click)="remove(p)"
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
  styles: `
    .file-input::file-selector-button {
      margin-right: 0.75rem;
      min-height: 2.75rem;
      padding: 0 0.75rem;
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text);
      cursor: pointer;
    }
  `,
})
export class ExhibitorPublicationsSection {
  /** Whether the exhibitor consented to the public directory (publications follow that consent). */
  readonly isPublic = input(false);

  private readonly repo = inject(ExhibitorPhotosRepository);
  private readonly uploader = inject(FileUploader);

  protected readonly valueOf = valueOf;
  protected readonly maxPublications = MAX_PUBLICATIONS_PER_EVENT;
  protected readonly events = signal<readonly ExhibitorEventOption[]>([]);
  protected readonly eventId = signal<string | null>(null);
  /** Publications only (profile photos are listed by their own section). */
  protected readonly publications = signal<readonly ExhibitorPhotoDto[]>([]);
  protected readonly caption = signal('');
  protected readonly drafts = signal<Readonly<Record<string, string>>>({});
  protected readonly busy = signal(false);
  protected readonly progress = signal(0);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal('');
  protected readonly loadError = signal<string | null>(null);

  protected readonly hasEvents = computed(() => this.events().length > 0);
  protected readonly inEvent = computed(() =>
    this.publications().filter((p) => p.eventId === this.eventId()),
  );
  protected readonly full = computed(() => !canPublishInEvent(this.inEvent().length));

  constructor() {
    this.repo.myEvents().subscribe({
      next: (events) => {
        this.events.set(events);
        if (events.length > 0 && this.eventId() === null) this.eventId.set(events[0].id);
      },
      error: () => this.loadError.set(LOAD_FAILED),
    });
    this.repo.list().subscribe({
      next: (list) => this.publications.set(list.filter((p) => p.eventId !== null)),
      error: () => this.loadError.set(LOAD_FAILED),
    });
  }

  protected chooseEvent(event: Event): void {
    this.eventId.set((event.target as HTMLSelectElement).value);
    this.error.set(null);
    this.status.set('');
  }

  protected draftOf(photo: ExhibitorPhotoDto): string {
    return this.drafts()[photo.id] ?? photo.caption ?? '';
  }

  protected setDraft(id: string, text: string): void {
    this.drafts.update((drafts) => ({ ...drafts, [id]: text }));
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const eventId = this.eventId();
    if (!file || !eventId || this.full()) return;
    this.error.set(null);
    this.status.set('');

    // Only supported videos are decoded; anything else is refused by type before reading it.
    const isVideo = file.type.startsWith('video/');
    const duration =
      isVideo && isSupportedVideo(file.type) && file.size <= MAX_VIDEO_BYTES
        ? await readVideoDuration(file)
        : null;
    const problem = publicationProblem({ type: file.type, size: file.size }, duration);
    if (problem) {
      this.error.set(problem);
      return;
    }
    await this.upload(file, eventId, isVideo ? duration : null);
  }

  protected async saveCaption(photo: ExhibitorPhotoDto): Promise<void> {
    const text = this.draftOf(photo).trim();
    if (!text) {
      this.error.set(EMPTY_CAPTION);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const updated = await firstValueFrom(this.repo.updateCaption(photo.id, text));
      this.publications.update((list) => list.map((p) => (p.id === photo.id ? updated : p)));
      this.drafts.update(({ [photo.id]: _removed, ...rest }) => rest);
      this.status.set('Guardamos el texto.');
    } catch (error: unknown) {
      this.error.set(messageFor(error, BY_CODE, {}, SAVE_FAILED));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(photo: ExhibitorPhotoDto): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.repo.remove(photo.id));
      this.publications.update((list) => list.filter((p) => p.id !== photo.id));
      this.status.set('Eliminamos la publicación.');
    } catch (error: unknown) {
      this.error.set(messageFor(error, BY_CODE, {}, REMOVE_FAILED));
    } finally {
      this.busy.set(false);
    }
  }

  private async upload(file: File, eventId: string, durationS: number | null): Promise<void> {
    this.busy.set(true);
    this.progress.set(0);
    this.status.set('Subiendo…');
    const text = this.caption().trim();
    try {
      const ticket = await firstValueFrom(
        this.repo.requestUpload({
          contentType: file.type as PhotoContentType,
          sizeBytes: file.size,
          eventId,
          ...(text ? { caption: text } : {}),
          ...(durationS !== null ? { durationS } : {}),
        }),
      );
      await lastValueFrom(
        this.uploader.put(ticket.upload, file).pipe(tap((percent) => this.progress.set(percent))),
      );
      const ready = await firstValueFrom(this.repo.complete(ticket.photo.id));
      this.publications.update((list) => [...list, ready]);
      this.caption.set('');
      this.status.set('Publicación subida.');
    } catch (error: unknown) {
      this.status.set('');
      this.error.set(messageFor(error, BY_CODE, {}, UPLOAD_FAILED));
    } finally {
      this.busy.set(false);
    }
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom, lastValueFrom } from 'rxjs';
import { messageFor } from '../../../shared/auth/problem';
import { valueOf } from '../../../shared/forms';
import { FileUploader } from '../../documents/data/document.repository';
import {
  ExhibitorPhotosRepository,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  PHOTO_TYPES,
  type ExhibitorPhotoDto,
  type PhotoContentType,
} from '../data/exhibitor-photos.repository';

const MAX_MB = MAX_PHOTO_BYTES / (1024 * 1024);
const LOAD_FAILED = 'No pudimos cargar tus fotos. Probá de nuevo en unos minutos.';
const UPLOAD_FAILED = 'No pudimos subir la foto. Probá de nuevo en unos minutos.';
const SEND_FAILED = 'No pudimos enviar la foto. Revisá tu conexión y probá de nuevo.';
const REMOVE_FAILED = 'No pudimos eliminar la foto. Probá de nuevo en unos minutos.';
const BY_CODE: Readonly<Record<string, string>> = {
  PHOTO_LIMIT: `Podés tener hasta ${MAX_PHOTOS} fotos. Eliminá alguna para subir otra.`,
  UPLOAD_MISSING: 'La foto no llegó. Probá subirla de nuevo.',
  UPLOAD_REJECTED: `La foto no es JPG, PNG o WebP, o pesa más de ${MAX_MB} MB, así que no se guardó.`,
};

const isAllowedType = (type: string): type is PhotoContentType =>
  (PHOTO_TYPES as readonly string[]).includes(type);

/**
 * Stand photos of the signed-in exhibitor (shown in the visitor's stand modal). Upload goes
 * browser -> storage with a presigned PUT; the API only registers and confirms it. Photos are
 * public only with the directory consent, which the parent owns (`isPublic`).
 */
@Component({
  selector: 'app-exhibitor-photos-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card mt-6 grid gap-4" aria-labelledby="photos-title">
      <header>
        <h2 id="photos-title" class="text-xl font-semibold">Fotos del stand</h2>
        <p class="mt-1 text-sm text-text-muted">
          Se muestran a los visitantes cuando tocan tu stand en el plano. JPG, PNG o WebP de hasta
          {{ maxMb }} MB.
        </p>
        @if (!isPublic()) {
          <p class="mt-2 rounded-lg bg-primary/10 p-3 text-sm" data-testid="photos-private">
            Tus fotos no se muestran al público hasta que aceptes aparecer en el directorio público
            (en tu perfil, más arriba).
          </p>
        }
      </header>

      <label class="grid gap-1 text-sm">
        <span>Texto alternativo para las próximas fotos (opcional)</span>
        <input
          class="field"
          type="text"
          maxlength="120"
          autocomplete="off"
          aria-describedby="photo-alt-hint"
          [value]="alt()"
          (input)="alt.set(valueOf($event))"
        />
        <span id="photo-alt-hint" class="text-xs text-text-muted">
          Describí lo que se ve, para quienes no pueden verla. Si lo dejás vacío usamos el nombre de
          tu emprendimiento.
        </span>
      </label>

      <div class="grid gap-1 text-sm">
        <label for="photo-file">
          Agregar fotos
          <span class="text-text-muted" data-testid="photo-count">
            ({{ photos().length }} de {{ maxPhotos }})
          </span>
        </label>
        <input
          #file
          id="photo-file"
          class="field"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          [disabled]="busy() || full()"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-describedby]="error() ? 'photos-error' : null"
          (change)="onFiles($event)"
        />
        @if (full()) {
          <span class="text-xs text-text-muted">
            Llegaste al máximo de {{ maxPhotos }} fotos. Eliminá una para subir otra.
          </span>
        }
        @if (error(); as message) {
          <span id="photos-error" role="alert" class="text-danger">{{ message }}</span>
        }
        @if (status(); as message) {
          <span role="status" class="text-text-muted">{{ message }}</span>
        }
      </div>

      @if (loadError(); as message) {
        <p role="alert" class="text-danger">{{ message }}</p>
      } @else if (photos().length > 0) {
        <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Fotos subidas">
          @for (p of photos(); track p.id; let i = $index) {
            <li class="grid gap-2">
              <img
                class="aspect-[4/3] w-full rounded-lg border border-border object-cover"
                [src]="p.url"
                [alt]="p.alt || 'Foto ' + (i + 1) + ' de tu stand'"
                width="400"
                height="300"
                loading="lazy"
                decoding="async"
              />
              <button
                type="button"
                class="btn"
                [disabled]="busy()"
                [attr.aria-label]="'Eliminar foto ' + (i + 1)"
                (click)="remove(p)"
              >
                Eliminar
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="text-sm text-text-muted" data-testid="photos-empty">
          Todavía no subiste fotos. Mostrá tu producto o tu stand armado.
        </p>
      }
    </section>
  `,
})
export class ExhibitorPhotosSection {
  /** Whether the exhibitor consented to the public directory (photos follow that consent). */
  readonly isPublic = input(false);

  private readonly repo = inject(ExhibitorPhotosRepository);
  private readonly uploader = inject(FileUploader);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('file');

  protected readonly valueOf = valueOf;
  protected readonly maxMb = MAX_MB;
  protected readonly maxPhotos = MAX_PHOTOS;
  protected readonly photos = signal<readonly ExhibitorPhotoDto[]>([]);
  protected readonly alt = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly status = signal('');
  protected readonly full = computed(() => this.photos().length >= MAX_PHOTOS);

  constructor() {
    this.repo.list().subscribe({
      next: (list) => this.photos.set(list),
      error: () => this.loadError.set(LOAD_FAILED),
    });
  }

  protected async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const chosen = [...(input.files ?? [])];
    input.value = '';
    if (chosen.length === 0) return;
    this.error.set(null);
    this.status.set('');

    const problems: string[] = [];
    const valid = chosen.filter((f) => {
      if (!isAllowedType(f.type)) {
        problems.push(`“${f.name}” no es JPG, PNG ni WebP.`);
        return false;
      }
      if (f.size > MAX_PHOTO_BYTES || f.size === 0) {
        problems.push(`“${f.name}” pesa más de ${MAX_MB} MB o está vacía.`);
        return false;
      }
      return true;
    });
    const room = MAX_PHOTOS - this.photos().length;
    if (valid.length > room)
      problems.push(`Solo entran ${room} foto${room === 1 ? '' : 's'} más; subimos las primeras.`);
    const queue = valid.slice(0, room);
    if (problems.length > 0) this.error.set(problems.join(' '));
    if (queue.length > 0) await this.upload(queue, problems);
  }

  protected async remove(photo: ExhibitorPhotoDto): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.repo.remove(photo.id));
      this.photos.update((list) => list.filter((p) => p.id !== photo.id));
      this.status.set('Eliminamos la foto.');
      this.fileInput().nativeElement.focus();
    } catch (error: unknown) {
      this.error.set(messageFor(error, BY_CODE, {}, REMOVE_FAILED));
    } finally {
      this.busy.set(false);
    }
  }

  /** One at a time: the API counts READY photos and the exhibitor sees honest progress. */
  private async upload(files: readonly File[], earlier: readonly string[]): Promise<void> {
    this.busy.set(true);
    let sent = 0;
    try {
      for (const file of files) {
        this.status.set(`Subiendo foto ${sent + 1} de ${files.length}…`);
        const ticket = await firstValueFrom(
          this.repo.requestUpload({
            contentType: file.type as PhotoContentType,
            sizeBytes: file.size,
            ...(this.alt().trim() ? { alt: this.alt().trim() } : {}),
          }),
        );
        try {
          await lastValueFrom(this.uploader.put(ticket.upload, file));
        } catch {
          this.error.set(SEND_FAILED);
          this.status.set('');
          return;
        }
        const ready = await firstValueFrom(this.repo.complete(ticket.photo.id));
        this.photos.update((list) => [...list, ready]);
        sent += 1;
      }
      this.status.set(sent === 1 ? 'Subimos la foto.' : `Subimos ${sent} fotos.`);
    } catch (error: unknown) {
      this.status.set('');
      const message = messageFor(error, BY_CODE, {}, UPLOAD_FAILED);
      this.error.set([...earlier, message].join(' '));
    } finally {
      this.busy.set(false);
    }
  }
}

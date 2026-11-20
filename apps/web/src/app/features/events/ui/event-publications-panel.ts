import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { messageFor } from '../../../shared/auth/problem';
import {
  EventPublicationsRepository,
  type EventPublicationDto,
} from '../data/event-publications.repository';

const LOAD_FAILED = 'No pudimos cargar las publicaciones de esta feria. Probá de nuevo en unos minutos.';
const CHANGE_FAILED = 'No pudimos cambiar la publicación. Probá de nuevo en unos minutos.';

/**
 * The organizer's view of a fair's publications (MED-11): hide one a visitor should not see, or
 * show it again. Hiding keeps the file; the exhibitor sees the publication marked as hidden.
 */
@Component({
  selector: 'app-event-publications-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="grid gap-3" aria-labelledby="event-publications-title">
      <header>
        <h2 id="event-publications-title" class="text-lg font-semibold">Publicaciones de los expositores</h2>
        <p class="mt-1 text-sm text-text-muted">
          Ocultá una publicación si no corresponde al público. Los visitantes dejan de verla en el
          plano y al compartirla; el expositor la ve marcada como oculta.
        </p>
      </header>

      @if (error(); as message) {
        <p role="alert" class="text-danger" data-testid="pub-error">{{ message }}</p>
      }

      @if (rows().length === 0) {
        <p class="text-sm text-text-muted" data-testid="pub-empty">
          Todavía no hay publicaciones en esta feria.
        </p>
      } @else {
        <ul class="grid gap-3 sm:grid-cols-2">
          @for (p of rows(); track p.id) {
            <li class="grid gap-2 rounded-lg border border-border p-3" data-testid="pub-row">
              @if (p.kind === 'VIDEO') {
                <video class="aspect-video w-full rounded-lg" [src]="p.url" controls preload="metadata"></video>
              } @else {
                <img class="aspect-[4/3] w-full rounded-lg object-cover" [src]="p.url" [alt]="p.caption || p.exhibitorName" loading="lazy" decoding="async" width="400" height="300" />
              }
              <p class="text-sm font-semibold">{{ p.exhibitorName }}</p>
              <p class="text-sm text-text-muted">{{ p.caption || 'Sin texto' }}</p>
              <p class="text-xs font-semibold" [attr.data-status]="p.status">
                {{ p.status === 'READY' ? 'Publicada' : 'Oculta' }}
              </p>
              <button type="button" class="btn" [disabled]="busy()" (click)="toggle(p)">
                {{ p.status === 'READY' ? 'Ocultar' : 'Mostrar' }}
              </button>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class EventPublicationsPanel {
  readonly eventId = input.required<string>();

  private readonly repo = inject(EventPublicationsRepository);

  protected readonly rows = signal<readonly EventPublicationDto[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    effect(() => {
      const id = this.eventId();
      this.repo.list(id).subscribe({
        next: (list) => this.rows.set(list),
        error: () => this.error.set(LOAD_FAILED),
      });
    });
  }

  protected async toggle(publication: EventPublicationDto): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const updated = await firstValueFrom(
        this.repo.setHidden(this.eventId(), publication.id, publication.status === 'READY'),
      );
      this.rows.update((list) => list.map((p) => (p.id === updated.id ? updated : p)));
    } catch (error: unknown) {
      this.error.set(messageFor(error, {}, {}, CHANGE_FAILED));
    } finally {
      this.busy.set(false);
    }
  }
}

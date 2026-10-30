import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { fold } from '../../shared/text';
import {
  PublicCatalogRepository,
  type PublicEventSummaryDto,
} from './data/public-catalog.repository';
import { dataOf, errorOf, toLoaded } from './ui/loaded';

const DAY = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
});
const DAY_YEAR = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Argentina/Buenos_Aires',
});

const dateRange = (e: PublicEventSummaryDto): string =>
  `${DAY.format(new Date(e.startsAt))} – ${DAY_YEAR.format(new Date(e.endsAt))}`;

/** P13 visitante: public fairs catalog (pub-ui-catalog D1). */
@Component({
  selector: 'app-fairs-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 lg:px-8">
      <header>
        <p class="text-sm font-semibold tracking-wider text-primary">VISITANTE</p>
        <h1 class="mt-1 text-3xl font-semibold">Ferias de emprendedores, del plano al stand</h1>
        <p class="mt-1 text-text-muted">
          Encontrá ferias cerca tuyo, mirá el plano y conocé a quienes exponen.
        </p>
      </header>

      <label class="flex max-w-md flex-col gap-1 text-sm font-medium">
        Buscar por nombre, ciudad o lugar
        <input
          type="search"
          class="field"
          placeholder="Ej.: Neuquén"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
        />
      </label>

      @if (error(); as message) {
        <p role="alert" class="card text-danger">{{ message }}</p>
      } @else if (events()) {
        <p class="sr-only" aria-live="polite">{{ visible().length }} ferias encontradas</p>
        @if (visible().length) {
          <ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            @for (e of visible(); track e.slug) {
              <li class="fair card flex flex-col gap-3">
                <div class="flex items-start justify-between gap-2">
                  <h2 class="text-lg font-semibold">{{ e.name }}</h2>
                  <span class="badge" [class.badge-open]="e.salesOpen">
                    {{ e.salesOpen ? 'Venta abierta' : 'Próximamente' }}
                  </span>
                </div>
                <p class="text-sm text-text-muted">
                  {{ dateRange(e) }} · {{ e.venueName }}, {{ e.city }}, {{ e.province }}
                </p>
                <p class="text-sm">{{ e.description }}</p>
                <p class="text-sm font-medium">
                  {{ e.availableStands }} de {{ e.totalStands }} stands disponibles
                </p>
                @if (e.hasPublicMap) {
                  <a [routerLink]="['/ferias', e.slug]" class="btn btn-primary mt-auto self-start">
                    Ver mapa y expositores
                  </a>
                } @else {
                  <p class="mt-auto text-xs text-text-muted">El plano todavía no está publicado.</p>
                }
              </li>
            }
          </ul>
        } @else {
          <p class="card text-text-muted">No hay ferias que coincidan con "{{ query() }}".</p>
        }
      } @else {
        <p class="text-text-muted" aria-live="polite">Cargando ferias…</p>
      }
    </section>
  `,
  styles: `
    .badge {
      flex-shrink: 0;
      padding: 0.125rem 0.625rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--color-text);
      background: var(--color-surface-soft);
      border: 1px solid var(--color-border);
    }
    .badge-open {
      background: color-mix(in srgb, var(--color-available) 16%, var(--color-surface));
      border-color: var(--color-available);
    }
  `,
})
export class FairsPage {
  protected readonly dateRange = dateRange;
  protected readonly query = signal('');

  private readonly state = toSignal(
    inject(PublicCatalogRepository)
      .listEvents()
      .pipe(toLoaded('No se pudieron cargar las ferias. Probá de nuevo en unos minutos.')),
    { initialValue: null },
  );
  protected readonly events = computed(() => dataOf(this.state()));
  protected readonly error = computed(() => errorOf(this.state()));

  protected readonly visible = computed(() => {
    const q = fold(this.query().trim());
    return (this.events() ?? []).filter(
      (e) => !q || fold(`${e.name} ${e.city} ${e.province} ${e.venueName}`).includes(q),
    );
  });
}

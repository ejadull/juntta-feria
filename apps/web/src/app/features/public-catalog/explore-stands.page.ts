import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { formatArs } from '../../shared/money';
import { DEMO_CONTEXT } from '../../shared/demo-context';
import { DEMO_EVENT_SLUG } from './data/in-memory-public-catalog.repository';
import { PublicCatalogRepository, STATUS_LABEL } from './data/public-catalog.repository';
import {
  areaOptions,
  matchesFilter,
  NO_FILTER,
  priceOptions,
  sectorsOf,
  standsOf,
  type StandFilter,
} from './domain/stand-filters';
import { dataOf, errorOf, toLoaded } from './ui/loaded';
import { StandMap } from './ui/stand-map/stand-map';

interface FilterChip {
  readonly label: string;
  readonly pressed: boolean;
  readonly patch: Partial<StandFilter>;
}

/** Chips for one filter key: "all" (null) plus one per value found in the data. */
function chips<K extends keyof StandFilter>(
  key: K,
  current: StandFilter[K],
  all: string,
  values: readonly NonNullable<StandFilter[K]>[],
  label: (v: NonNullable<StandFilter[K]>) => string,
): FilterChip[] {
  return [
    { label: all, pressed: current === null, patch: { [key]: null } },
    ...values.map((v) => ({ label: label(v), pressed: current === v, patch: { [key]: v } })),
  ];
}

/** P07 feriante "Elegí tu stand" (pub-ui-catalog D5): plan + equivalent list + detail. */
@Component({
  selector: 'app-explore-stands-page',
  imports: [StandMap],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 lg:px-8">
      <header>
        <p class="text-sm font-semibold tracking-wider text-primary">FERIANTE · {{ eventName }}</p>
        <h1 class="mt-1 text-3xl font-semibold">Elegí tu stand</h1>
        <p class="mt-1 text-text-muted">
          Filtrá por sector, superficie y precio. El precio es final, en pesos argentinos.
        </p>
      </header>

      @if (error(); as message) {
        <p role="alert" class="card text-danger">{{ message }}</p>
      } @else if (map(); as m) {
        <div class="flex flex-col gap-3">
          @for (group of groups(); track group.label) {
            <div class="flex flex-wrap items-center gap-2">
              <span class="w-24 shrink-0 text-sm font-semibold text-text-muted">{{
                group.label
              }}</span>
              <div class="flex flex-wrap gap-1.5" role="group" [attr.aria-label]="group.label">
                @for (c of group.chips; track c.label) {
                  <button
                    type="button"
                    class="chip"
                    [attr.aria-pressed]="c.pressed"
                    (click)="applyFilter(c.patch)"
                  >
                    {{ c.label }}
                  </button>
                }
              </div>
            </div>
          }
        </div>

        <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <app-stand-map
            class="h-[26rem] rounded-xl border border-border lg:h-[36rem]"
            [map]="m"
            [filter]="filter()"
            [selectedId]="selectedId()"
            (select)="selectedId.set($event)"
          />

          <div class="flex min-w-0 flex-col gap-4">
            <section class="stand-detail card" aria-live="polite">
              @if (selected(); as s) {
                <h2 class="text-lg font-semibold">Stand {{ s.code }}</h2>
                <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt class="text-text-muted">Sector</dt>
                  <dd>{{ s.sector ?? 'Sin sector' }}</dd>
                  <dt class="text-text-muted">Superficie</dt>
                  <dd>{{ s.areaM2 }} m²</dd>
                  <dt class="text-text-muted">Estado</dt>
                  <dd>{{ statusLabel[s.status] }}</dd>
                  <dt class="text-text-muted">Precio final</dt>
                  <dd class="font-semibold">{{ formatArs(s.priceCents) }}</dd>
                </dl>
                @if (s.status === 'AVAILABLE') {
                  <button
                    type="button"
                    class="btn btn-primary mt-4 w-full justify-center"
                    disabled
                    aria-describedby="reserve-note"
                  >
                    Reservar
                  </button>
                  <p id="reserve-note" class="mt-2 text-xs text-text-muted">
                    La reserva se habilita con <strong>RES-01</strong> (hold y pago con Mercado
                    Pago).
                  </p>
                } @else {
                  <p class="mt-3 text-sm text-text-muted">
                    Este stand no está disponible para reservar.
                  </p>
                }
              } @else {
                <h2 class="text-lg font-semibold">Ningún stand elegido</h2>
                <p class="mt-1 text-sm text-text-muted">
                  Tocá un stand en el plano o en la lista para ver su detalle.
                </p>
              }
            </section>

            <section class="card flex min-h-0 flex-col p-0">
              <h2 class="stand-list-heading border-b border-border px-4 py-3 font-semibold">
                {{ available().length }}
                {{ available().length === 1 ? 'stand disponible' : 'stands disponibles' }}
              </h2>
              @if (available().length) {
                <ul class="stand-list max-h-80 overflow-y-auto p-2">
                  @for (s of available(); track s.id) {
                    <li>
                      <button
                        type="button"
                        class="item"
                        [attr.data-code]="s.code"
                        [attr.aria-pressed]="s.id === selectedId()"
                        (click)="selectedId.set(s.id)"
                      >
                        <span class="font-semibold">{{ s.code }}</span>
                        <span class="min-w-0 flex-1 truncate text-text-muted">
                          {{ s.sector ?? 'Sin sector' }} · {{ s.areaM2 }} m²
                        </span>
                        <span class="font-medium">{{ formatArs(s.priceCents) }}</span>
                      </button>
                    </li>
                  }
                </ul>
              } @else {
                <p class="p-4 text-sm text-text-muted">
                  No hay stands disponibles con esos filtros. Probá ampliarlos.
                </p>
              }
            </section>
          </div>
        </div>
      } @else {
        <p class="text-text-muted" aria-live="polite">Cargando plano…</p>
      }
    </section>
  `,
  styles: `
    .chip {
      min-height: 2.25rem;
      padding: 0 0.875rem;
      border: 1px solid var(--color-border-strong);
      border-radius: 999px;
      background: var(--color-surface);
      font-size: 0.875rem;
      color: var(--color-text);
      white-space: nowrap;
    }
    .chip[aria-pressed='true'] {
      border-color: var(--color-primary);
      background: var(--color-primary);
      color: var(--color-surface);
      font-weight: 600;
    }
    .chip:focus-visible,
    .item:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: 2px;
    }
    .item {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 0.75rem;
      min-height: 2.75rem;
      padding: 0 0.75rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      text-align: left;
      color: var(--color-text);
    }
    .item:hover {
      background: var(--color-surface-soft);
    }
    .item[aria-pressed='true'] {
      background: color-mix(in srgb, var(--color-selected) 12%, var(--color-surface));
      box-shadow: inset 3px 0 0 var(--color-selected);
    }
  `,
})
export class ExploreStandsPage {
  protected readonly eventName = DEMO_CONTEXT.event.name;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly formatArs = formatArs;

  // ponytail: demo event fixed until the feriante picks one (session CORE-02 + catalog).
  private readonly state = toSignal(
    inject(PublicCatalogRepository)
      .getMap(DEMO_EVENT_SLUG)
      .pipe(toLoaded('No se pudo cargar el plano. Probá de nuevo en unos minutos.')),
    { initialValue: null },
  );
  protected readonly map = computed(() => dataOf(this.state()));
  protected readonly error = computed(() => errorOf(this.state()));

  protected readonly filter = signal<StandFilter>(NO_FILTER);
  protected readonly selectedId = signal<string | null>(null);

  private readonly stands = computed(() => {
    const m = this.map();
    return m ? standsOf(m) : [];
  });
  protected readonly selected = computed(
    () => this.stands().find((s) => s.id === this.selectedId()) ?? null,
  );
  protected readonly available = computed(() =>
    this.stands().filter((s) => s.status === 'AVAILABLE' && matchesFilter(s, this.filter())),
  );

  protected readonly groups = computed(() => {
    const stands = this.stands();
    const f = this.filter();
    return [
      { label: 'Sector', chips: chips('sector', f.sector, 'Todos', sectorsOf(stands), (s) => s) },
      {
        label: 'Superficie',
        chips: chips(
          'minAreaM2',
          f.minAreaM2,
          'Todas',
          areaOptions(stands),
          (a) => `desde ${a} m²`,
        ),
      },
      {
        label: 'Precio',
        chips: chips(
          'maxPriceCents',
          f.maxPriceCents,
          'Todos',
          priceOptions(stands),
          (p) => `hasta ${formatArs(p)}`,
        ),
      },
    ];
  });

  protected applyFilter(patch: Partial<StandFilter>): void {
    this.filter.update((current) => ({ ...current, ...patch }));
  }
}

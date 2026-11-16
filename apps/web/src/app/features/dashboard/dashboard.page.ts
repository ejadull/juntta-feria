import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, filter, map, of, startWith, switchMap } from 'rxjs';
import {
  currentEvent,
  EventsRepository,
  type OrganizerEvent,
} from '../../shared/events/events.repository';
import { formatArs } from '../../shared/money';
import {
  EventMetricsRepository,
  EventNotFoundError,
  type EventMetricsDto,
} from './data/event-metrics.repository';
import { ExportCsvButton } from '../reports/ui/export-csv-button';
import { occupancy } from './domain/occupancy';
import { SetupChecklist } from './ui/setup-checklist';
import { GmvChart } from './ui/gmv-chart';
import { KpiCard } from './ui/kpi-card';

/** Event dates are shown in the event's timezone (spec §0). */
const TZ = 'America/Argentina/Buenos_Aires';
const DAY = new Intl.DateTimeFormat('es-AR', { day: 'numeric', timeZone: TZ });
const DAY_MONTH = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'short',
  timeZone: TZ,
});
const MONTH_KEY = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  timeZone: TZ,
});

/** '20–22 nov' within a month, '30 nov – 2 dic' across months. */
function dateRange(startsAt: string, endsAt: string): string {
  const [a, b] = [new Date(startsAt), new Date(endsAt)];
  const dm = (d: Date) => DAY_MONTH.format(d).replace('.', '');
  return MONTH_KEY.format(a) === MONTH_KEY.format(b)
    ? `${DAY.format(a)}–${dm(b)}`
    : `${dm(a)} – ${dm(b)}`;
}

interface Kpi {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}

function kpis(m: EventMetricsDto): readonly Kpi[] {
  const pct = occupancy(m.assignedStands, m.sellableStands);
  return [
    {
      label: 'Stands comercializables',
      value: String(m.sellableStands),
      detail: `${m.blockedStands} bloqueados`,
    },
    {
      label: 'Ocupación',
      value: pct === null ? '—' : `${pct} %`,
      detail: `${m.assignedStands} asignados de ${m.sellableStands}`,
    },
    {
      label: 'GMV aprobado',
      value: formatArs(m.approvedGmvCents, { compact: true }),
      detail: 'Cobrado por el organizador; no es ingreso SaaS',
    },
    {
      label: 'Reservas en curso',
      value: String(m.activeReservations),
      detail: `${m.reconciliationPending} en conciliación`,
    },
  ];
}

type State = { readonly metrics: EventMetricsDto } | { readonly error: string };
type Events = { readonly list: readonly OrganizerEvent[] } | { readonly error: string };

const EVENTS_FAILED = 'No pudimos cargar tus eventos. Probá de nuevo en unos minutos.';

/** P03 (design D2/D3): read-only KPIs of the current event (REP-01), switchable between events. */
@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, KpiCard, GmvChart, ExportCsvButton, SetupChecklist],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block lg:h-full' },
  template: `
    <div class="flex flex-col gap-4 p-4 sm:p-6 lg:h-full">
      <header class="flex shrink-0 flex-wrap items-center justify-between gap-4">
        <div class="flex min-w-0 items-center gap-3">
          <span
            class="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary-strong"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" class="size-6">
              <path
                d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <div class="min-w-0">
            <h1 class="text-2xl font-semibold">Panel del evento</h1>
            @if (metrics(); as m) {
              <p class="truncate text-sm text-text-muted">
                <strong class="font-semibold text-text">{{ m.eventName }}</strong>
                · {{ dates() }} · {{ m.venueName }}
              </p>
            }
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          @if (events().length > 1) {
            <label class="flex items-center gap-2 text-sm font-medium">
              Evento
              <select class="field min-h-11" (change)="chooseEvent(valueOf($event))">
                @for (event of events(); track event.id) {
                  <option [value]="event.id" [selected]="event.id === eventId()">
                    {{ event.name }}
                  </option>
                }
              </select>
            </label>
          }
          <app-export-csv-button [eventId]="eventId()" />
        </div>
      </header>

      @if (error(); as message) {
        <p role="alert" class="rounded-xl bg-danger/10 p-4 text-text">{{ message }}</p>
      } @else if (noEvents()) {
        <div class="card" data-testid="no-events">
          <p class="font-semibold">Todavía no hay eventos</p>
          <p class="mt-1 text-sm text-text-muted">
            Cuando tu organización cree y publique su primer evento, acá vas a ver ocupación, ventas
            y reservas.
          </p>
          <a
            class="btn btn-primary mt-4 min-h-11"
            routerLink="/organizador/eventos"
            [queryParams]="{ nuevo: 1 }"
          >
            Crear evento
          </a>
        </div>
        <app-setup-checklist [events]="events()" />
      } @else if (metrics(); as m) {
        @if (!selling()) {
          <app-setup-checklist [events]="events()" />
        }
        <section
          aria-label="Indicadores"
          class="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          @for (k of kpis(); track k.label) {
            <app-kpi-card [label]="k.label" [value]="k.value" [detail]="k.detail" />
          }
        </section>

        <div
          class="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface lg:min-h-0 lg:flex-1"
        >
          <div
            class="grid shrink-0 grid-cols-1 border-b border-border bg-surface-soft text-xs font-semibold tracking-wider text-text-muted uppercase lg:grid-cols-3"
          >
            <p class="px-5 py-3 lg:col-span-2">Ventas</p>
            <p class="hidden px-5 py-3 lg:block">Operación</p>
          </div>
          <div class="grid grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-3 lg:overflow-auto">
            <section
              class="border-b border-border p-5 lg:col-span-2 lg:border-r lg:border-b-0"
              aria-labelledby="gmv-title"
            >
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="gmv-title" class="text-base font-semibold">GMV aprobado por mes</h2>
                <p class="text-xs text-text-muted">
                  Venta de stands cobrada por el organizador · no es ingreso SaaS
                </p>
              </div>
              <app-gmv-chart class="mt-3 block" [points]="m.gmvByMonth" />
            </section>

            <div class="flex flex-col divide-y divide-border">
              <section class="flex flex-col gap-3 p-5" aria-labelledby="plan-title">
                <h2 id="plan-title" class="text-base font-semibold">Plano del evento</h2>
                <p class="text-sm text-text-muted">
                  Ocupación por sector: disponible con EVT-01 (los sectores son del evento, ADR
                  0002).
                </p>
                <a
                  class="btn min-h-11 justify-center"
                  [routerLink]="['/organizador/layouts', m.layoutVersionId, 'editor']"
                >
                  Abrir editor de plano
                </a>
              </section>

              <section class="p-5" aria-labelledby="ops-title">
                <h2 id="ops-title" class="text-base font-semibold">Últimas operaciones</h2>
                <p class="mt-1 text-sm text-text-muted">
                  Disponible con <strong>RES-01</strong> (reservas). No se muestran operaciones
                  simuladas.
                </p>
              </section>

              <section class="p-5" aria-labelledby="pay-title">
                <h2 id="pay-title" class="text-base font-semibold">Estado de cobros</h2>
                <p class="mt-1 text-sm text-text-muted">
                  Disponible con <strong>PAY-01</strong> (Mercado Pago y conciliación).
                </p>
              </section>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class DashboardPage {
  private readonly repo = inject(EventMetricsRepository);

  private readonly eventsState = toSignal<Events | null>(
    inject(EventsRepository)
      .list()
      .pipe(
        map((list): Events => ({ list })),
        catchError(() => of<Events>({ error: EVENTS_FAILED })),
      ),
    { initialValue: null },
  );
  protected readonly events = computed(() => {
    const s = this.eventsState();
    return s && 'list' in s ? s.list : [];
  });
  protected readonly noEvents = computed(() => {
    const s = this.eventsState();
    return !!s && 'list' in s && s.list.length === 0;
  });

  protected readonly selling = computed(() =>
    this.events().some((e) => e.status === 'PUBLISHED' || e.status === 'ACTIVE'),
  );

  private readonly chosenId = signal<string | null>(null);
  /** The user's pick, else the most recent event on sale. */
  protected readonly eventId = computed(
    () => this.chosenId() ?? currentEvent(this.events())?.id ?? null,
  );

  private readonly state = toSignal<State | null>(
    toObservable(this.eventId).pipe(
      filter((id): id is string => id !== null),
      switchMap((id) =>
        this.repo.get(id).pipe(
          map((metrics): State => ({ metrics })),
          catchError((error: unknown) =>
            of<State>({
              error:
                error instanceof EventNotFoundError
                  ? 'No se encontraron métricas para este evento.'
                  : 'No se pudieron cargar las métricas. Probá de nuevo en unos minutos.',
            }),
          ),
          startWith(null),
        ),
      ),
    ),
    { initialValue: null },
  );

  protected readonly metrics = computed(() => {
    const s = this.state();
    return s && 'metrics' in s ? s.metrics : null;
  });
  protected readonly error = computed(() => {
    const events = this.eventsState();
    if (events && 'error' in events) return events.error;
    const s = this.state();
    return s && 'error' in s ? s.error : null;
  });
  protected readonly kpis = computed(() => {
    const m = this.metrics();
    return m ? kpis(m) : [];
  });
  protected readonly dates = computed(() => {
    const m = this.metrics();
    return m ? dateRange(m.startsAt, m.endsAt) : '';
  });

  protected chooseEvent(id: string): void {
    this.chosenId.set(id);
  }

  protected valueOf(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }
}

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
  imports: [RouterLink, KpiCard, GmvChart, ExportCsvButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-sm font-semibold tracking-wider text-primary-strong">ORGANIZADOR</p>
          <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Panel del evento</h1>
          @if (metrics(); as m) {
            <p class="mt-2 text-text-muted">
              <strong class="font-semibold text-text">{{ m.eventName }}</strong>
              · {{ dates() }} · {{ m.venueName }}
            </p>
          }
        </div>
        @if (events().length > 1) {
          <label class="flex items-center gap-2 text-sm font-medium">
            Evento
            <select class="field" (change)="chooseEvent(valueOf($event))">
              @for (event of events(); track event.id) {
                <option [value]="event.id" [selected]="event.id === eventId()">
                  {{ event.name }}
                </option>
              }
            </select>
          </label>
        }
        <app-export-csv-button [eventId]="eventId()" />
      </header>

      @if (error(); as message) {
        <p role="alert" class="mt-6 rounded-xl bg-danger/10 p-4 text-text">{{ message }}</p>
      } @else if (noEvents()) {
        <div class="card mt-6" data-testid="no-events">
          <p class="font-semibold">Todavía no hay eventos</p>
          <p class="mt-1 text-sm text-text-muted">
            Cuando tu organización cree y publique su primer evento, acá vas a ver ocupación, ventas
            y reservas. Mientras tanto, dejá lista la cuenta de cobro.
          </p>
          <a class="btn btn-primary mt-4" routerLink="/organizador/mercado-pago">
            Vincular Mercado Pago
          </a>
        </div>
      } @else if (metrics(); as m) {
        <section
          aria-label="Indicadores"
          class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          @for (k of kpis(); track k.label) {
            <app-kpi-card [label]="k.label" [value]="k.value" [detail]="k.detail" />
          }
        </section>

        <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section class="card lg:col-span-2" aria-labelledby="gmv-title">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="gmv-title" class="text-lg font-semibold">GMV aprobado por mes</h2>
              <p class="text-xs text-text-muted">
                Venta de stands cobrada por el organizador · no es ingreso SaaS
              </p>
            </div>
            <app-gmv-chart class="mt-4 block" [points]="m.gmvByMonth" />
          </section>

          <section class="card flex flex-col gap-3" aria-labelledby="plan-title">
            <h2 id="plan-title" class="text-lg font-semibold">Plano del evento</h2>
            <p class="text-sm text-text-muted">
              Ocupación por sector: disponible con EVT-01 (los sectores son del evento, ADR 0002).
            </p>
            <a
              class="btn mt-auto justify-center"
              [routerLink]="['/organizador/layouts', m.layoutVersionId, 'editor']"
            >
              Abrir editor de plano
            </a>
          </section>

          <section class="card lg:col-span-2" aria-labelledby="ops-title">
            <h2 id="ops-title" class="text-lg font-semibold">Últimas operaciones</h2>
            <p class="mt-2 text-sm text-text-muted">
              Disponible con <strong>RES-01</strong> (reservas). No se muestran operaciones
              simuladas.
            </p>
          </section>

          <section class="card" aria-labelledby="pay-title">
            <h2 id="pay-title" class="text-lg font-semibold">Estado de cobros</h2>
            <p class="mt-2 text-sm text-text-muted">
              Disponible con <strong>PAY-01</strong> (Mercado Pago y conciliación).
            </p>
          </section>
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

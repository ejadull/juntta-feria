import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';
import { problemOf } from '../../shared/auth/problem';
import { SessionStore } from '../../shared/auth/session.store';
import { formatArs } from '../../shared/money';
import type { ReservationStatus } from '../checkout-return/data/reservation-payment.repository';
import { ExportCsvButton } from '../reports/ui/export-csv-button';
import { isPayable, STATUS_LABEL, statusText } from '../reservations/reservation-status';
import {
  OrganizerReservationsRepository,
  type OrganizerEventDto,
  type OrganizerReservationDto,
  type PaymentIncidentDto,
} from './data/organizer-reservations.repository';
import { actionError, INCIDENT, PAYMENT_LABEL, STATUS_ICON, STATUS_ORDER } from './labels';

type ActionKind = 'cancel' | 'cancel-payment' | 'refund';
type Incidents = readonly PaymentIncidentDto[] | 'hidden' | 'failed';

/** What the organizer is about to confirm. The key is per action, so a retry never repeats it. */
interface Pending {
  readonly kind: ActionKind;
  readonly reservationId: string;
  readonly label: string;
  readonly maxCents: number | null;
  readonly partialAllowed: boolean;
  readonly key: string;
}

const SELLING: readonly string[] = ['PUBLISHED', 'ACTIVE', 'CLOSED'];
const TZ = 'America/Argentina/Buenos_Aires';
const WHEN = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: TZ,
});
const DAY = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeZone: TZ });

const TITLE: Readonly<Record<ActionKind, string>> = {
  cancel: '¿Cancelar la reserva?',
  'cancel-payment': '¿Cancelar el cobro y la reserva?',
  refund: '¿Devolver el pago?',
};
const EXPLANATION: Readonly<Record<ActionKind, string>> = {
  cancel: 'El stand queda libre para otro feriante. Esta acción no se puede deshacer.',
  'cancel-payment':
    'Se cancela el pago pendiente en Mercado Pago y la reserva. Esta acción no se puede deshacer.',
  refund:
    'Se le devuelve el dinero al feriante por Mercado Pago. Si es total, el stand queda libre. No se puede deshacer.',
};
const CONFIRM: Readonly<Record<ActionKind, string>> = {
  cancel: 'Sí, cancelar reserva',
  'cancel-payment': 'Sí, cancelar cobro',
  refund: 'Sí, devolver',
};
const KIND_LABEL: Readonly<Record<ActionKind, string>> = {
  cancel: 'Cancelar',
  'cancel-payment': 'Cancelar cobro',
  refund: 'Devolver pago',
};

const LOAD_FAILED = 'No pudimos cargar las reservas. Probá de nuevo en unos minutos.';
const AMOUNT_INVALID = 'Ingresá un monto válido en pesos, mayor a cero.';
const AMOUNT_TOO_HIGH = 'El monto no puede superar lo que pagó el feriante.';

/** "1.500,50", "1500,5" or "1500.5" → cents; null when it is not a positive amount. */
function parsePesos(text: string): number | null {
  const raw = text.trim();
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

/**
 * P09 (RES-01, PAY-05, PAY-06): the organizer's reservations and payments of one event, with
 * the actions its role allows and the payment incidents that need a human.
 */
@Component({
  selector: 'app-organizer-reservations-page',
  imports: [ExportCsvButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-sm font-semibold tracking-wider text-primary-strong">ORGANIZADOR</p>
          <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Reservas y cobros</h1>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <app-export-csv-button [eventId]="eventId()" />
          <button type="button" class="btn" [disabled]="loading()" (click)="refresh()">
            Actualizar
          </button>
        </div>
      </header>
      <p class="mt-3 text-text-muted">
        Quién reservó cada stand, el estado de su pago y las acciones que podés hacer.
      </p>

      @if (notice(); as message) {
        <p
          role="status"
          data-testid="notice"
          class="mt-4 rounded-xl bg-available/15 p-3 text-sm text-text"
        >
          {{ message }}
        </p>
      }

      @if (loadError(); as message) {
        <p role="alert" class="card mt-6 text-danger">{{ message }}</p>
      } @else if (events(); as list) {
        @if (list.length === 0) {
          <div class="card mt-6">
            <p class="font-semibold">Todavía no hay eventos a la venta</p>
            <p class="mt-1 text-sm text-text-muted">
              Cuando publiques un evento, sus reservas aparecen acá.
            </p>
          </div>
        } @else {
          <div class="mt-6 flex flex-wrap items-center gap-3">
            <label for="event" class="text-sm font-medium">Evento</label>
            <select
              id="event"
              class="field"
              [value]="eventId()"
              (change)="chooseEvent(valueOf($event))"
            >
              @for (event of list; track event.id) {
                <option [value]="event.id" [selected]="event.id === eventId()">
                  {{ event.name }}
                </option>
              }
            </select>
          </div>

          @if (rows(); as all) {
            <div role="group" aria-label="Filtrar por estado" class="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                class="btn"
                [class.btn-primary]="filter() === null"
                [attr.aria-pressed]="filter() === null"
                (click)="filter.set(null)"
              >
                Todas ({{ all.length }})
              </button>
              @for (chip of chips(); track chip.status) {
                <button
                  type="button"
                  class="btn"
                  [class.btn-primary]="filter() === chip.status"
                  [attr.aria-pressed]="filter() === chip.status"
                  (click)="filter.set(chip.status)"
                >
                  <span aria-hidden="true">{{ icon[chip.status] }}</span>
                  {{ chip.label }} ({{ chip.count }})
                </button>
              }
            </div>

            @if (visible().length === 0) {
              <div class="card mt-4">
                <p class="font-semibold">
                  {{
                    all.length === 0
                      ? 'Todavía no hay reservas en este evento'
                      : 'Ninguna reserva con este estado'
                  }}
                </p>
              </div>
            } @else {
              <div class="card mt-4 overflow-x-auto p-0">
                <table class="w-full min-w-[44rem] text-left text-sm">
                  <caption class="sr-only">
                    Reservas del evento
                    {{
                      eventName()
                    }}
                  </caption>
                  <thead class="bg-surface-soft">
                    <tr>
                      <th scope="col" class="px-4 py-2 font-semibold">Stand</th>
                      <th scope="col" class="px-4 py-2 font-semibold">Feriante</th>
                      <th scope="col" class="px-4 py-2 font-semibold">Monto</th>
                      <th scope="col" class="px-4 py-2 font-semibold">Estado</th>
                      <th scope="col" class="px-4 py-2 font-semibold">Vencimiento o fecha</th>
                      <th scope="col" class="px-4 py-2 font-semibold">Pago</th>
                      <th scope="col" class="px-4 py-2 font-semibold">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of visible(); track row.reservation.id) {
                      <tr class="border-t border-border align-top" data-testid="reservation">
                        <th scope="row" class="px-4 py-3 font-semibold">
                          {{ row.reservation.stand.code }}
                        </th>
                        <td class="px-4 py-3">
                          <p class="font-medium">{{ row.reservation.exhibitor.tradeName }}</p>
                          <p class="break-all text-text-muted">
                            {{ row.reservation.exhibitor.email }}
                          </p>
                        </td>
                        <td class="px-4 py-3">{{ price(row.reservation.amount.valueCents) }}</td>
                        <td class="px-4 py-3">
                          <span aria-hidden="true">{{ icon[row.reservation.status] }}</span>
                          {{ row.status }}
                        </td>
                        <td class="px-4 py-3">{{ row.when }}</td>
                        <td class="px-4 py-3">{{ row.payment }}</td>
                        <td class="px-4 py-3">
                          @if (row.action; as kind) {
                            <button
                              type="button"
                              class="btn btn-danger"
                              [disabled]="busy() || pending() !== null"
                              [attr.aria-label]="
                                kindLabel[kind] + ' del stand ' + row.reservation.stand.code
                              "
                              (click)="ask(kind, row.reservation)"
                            >
                              {{ kindLabel[kind] }}
                            </button>
                          } @else {
                            <span class="text-text-muted">—</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          } @else {
            <p role="status" class="mt-6 text-text-muted">Cargando las reservas…</p>
          }
        }
      } @else {
        <p role="status" class="mt-6 text-text-muted">Cargando las reservas…</p>
      }

      @if (pending(); as p) {
        <section
          role="alertdialog"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-text"
          class="card mt-6 border-border-strong"
        >
          <h2 id="confirm-title" class="font-semibold">{{ titles[p.kind] }}</h2>
          <p class="mt-1 text-sm">{{ p.label }}</p>
          <p id="confirm-text" class="mt-1 text-sm text-text-muted">{{ explanations[p.kind] }}</p>
          @if (p.partialAllowed) {
            <div class="mt-3 flex flex-col gap-1">
              <label for="amount" class="text-sm font-medium">
                Monto a devolver en pesos (opcional)
              </label>
              <input
                id="amount"
                class="field max-w-xs"
                inputmode="decimal"
                autocomplete="off"
                placeholder="Vacío devuelve todo"
                [value]="amount()"
                (input)="changeAmount(valueOf($event))"
              />
            </div>
          }
          @if (actionFailure(); as message) {
            <p role="alert" class="mt-3 text-sm text-danger">{{ message }}</p>
          }
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="confirm()">
              {{ confirms[p.kind] }}
            </button>
            <button #dismiss type="button" class="btn" [disabled]="busy()" (click)="close()">
              No, volver
            </button>
          </div>
        </section>
      }

      <section class="mt-10" aria-labelledby="incidents-heading">
        <h2 id="incidents-heading" class="text-xl font-semibold">Incidencias de pago</h2>
        @if (incidents(); as found) {
          @if (found === 'hidden') {
            <p class="mt-2 text-sm text-text-muted">
              Las incidencias de pago las ven solo quienes administran la organización.
            </p>
          } @else if (found === 'failed') {
            <p role="alert" class="mt-2 text-sm text-danger">
              No pudimos cargar las incidencias. Probá con Actualizar.
            </p>
          } @else if (found.length === 0) {
            <p class="mt-2 text-sm text-text-muted">No hay incidencias de pago. Todo conciliado.</p>
          } @else {
            <ul class="mt-3 flex flex-col gap-3">
              @for (item of found; track item.id) {
                <li class="card flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="incident">
                  <div class="min-w-0 flex-1">
                    <p class="font-semibold">
                      <span aria-hidden="true">!</span>
                      {{ incident[item.code].title }}
                      @if (standOf(item.reservationId); as code) {
                        <span class="font-normal text-text-muted"> · Stand {{ code }}</span>
                      }
                    </p>
                    <p class="text-sm text-text-muted">{{ incident[item.code].detail }}</p>
                    <p class="text-sm text-text-muted">{{ day(item.createdAt) }}</p>
                  </div>
                  @if (canManageMoney() && item.reservationId) {
                    <button
                      type="button"
                      class="btn btn-danger"
                      [disabled]="busy() || pending() !== null"
                      [attr.aria-label]="incidentAction(item)"
                      (click)="askIncident(item)"
                    >
                      Devolver pago
                    </button>
                  }
                </li>
              }
            </ul>
          }
        }
      </section>
    </div>
  `,
})
export class OrganizerReservationsPage {
  private readonly repository = inject(OrganizerReservationsRepository);
  private readonly session = inject(SessionStore);
  private readonly injector = inject(Injector);
  private readonly dismiss = viewChild<ElementRef<HTMLButtonElement>>('dismiss');

  protected readonly price = formatArs;
  protected readonly icon = STATUS_ICON;
  protected readonly incident = INCIDENT;
  protected readonly titles = TITLE;
  protected readonly explanations = EXPLANATION;
  protected readonly confirms = CONFIRM;
  protected readonly kindLabel = KIND_LABEL;

  protected readonly events = signal<readonly OrganizerEventDto[] | null>(null);
  protected readonly eventId = signal<string | null>(null);
  protected readonly reservations = signal<readonly OrganizerReservationDto[] | null>(null);
  protected readonly incidents = signal<Incidents | null>(null);
  protected readonly filter = signal<ReservationStatus | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly pending = signal<Pending | null>(null);
  protected readonly amount = signal('');
  protected readonly actionFailure = signal<string | null>(null);
  protected readonly busy = signal(false);

  /** Owners and admins handle money (refunds, incidents); operators only release holds. */
  protected readonly canManageMoney = computed(() => {
    const role = this.session
      .memberships()
      .find((m) => m.tenantId === this.session.tenantId())?.role;
    return role === 'OWNER' || role === 'ADMIN';
  });

  protected readonly eventName = computed(
    () => this.events()?.find((e) => e.id === this.eventId())?.name ?? '',
  );

  protected readonly rows = computed(() => {
    const list = this.reservations();
    if (!list) return null;
    const now = Date.now();
    return list.map((reservation) => ({
      reservation,
      status: statusText(reservation, now),
      when: this.when(reservation, now),
      payment: reservation.payment ? PAYMENT_LABEL[reservation.payment.status] : '—',
      action: this.actionFor(reservation, now),
    }));
  });

  protected readonly chips = computed(() => {
    const all = this.rows() ?? [];
    return STATUS_ORDER.map((status) => ({
      status,
      count: all.filter((r) => r.reservation.status === status).length,
      label: STATUS_LABEL[status],
    })).filter((chip) => chip.count > 0);
  });

  protected readonly visible = computed(() => {
    const status = this.filter();
    const all = this.rows() ?? [];
    return status ? all.filter((r) => r.reservation.status === status) : all;
  });

  constructor() {
    this.load(true);
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected day(iso: string): string {
    return DAY.format(new Date(iso));
  }

  protected standOf(reservationId: string | null): string | null {
    return this.reservations()?.find((r) => r.id === reservationId)?.stand.code ?? null;
  }

  protected incidentAction(item: PaymentIncidentDto): string {
    const code = this.standOf(item.reservationId);
    return `Devolver pago ${code ? `del stand ${code}` : 'de la reserva'}`;
  }

  protected refresh(): void {
    this.notice.set(null);
    this.load(false);
  }

  protected chooseEvent(id: string): void {
    this.eventId.set(id);
    this.filter.set(null);
    this.notice.set(null);
    this.close();
    this.loadReservations();
  }

  protected ask(kind: ActionKind, reservation: OrganizerReservationDto): void {
    this.open({
      kind,
      reservationId: reservation.id,
      label: `Stand ${reservation.stand.code} · ${reservation.exhibitor.tradeName} · ${formatArs(reservation.amount.valueCents)}`,
      maxCents: reservation.amount.valueCents,
      partialAllowed: kind === 'refund' && reservation.status === 'CONFIRMED',
      key: crypto.randomUUID(),
    });
  }

  protected askIncident(item: PaymentIncidentDto): void {
    const reservation = this.reservations()?.find((r) => r.id === item.reservationId);
    this.open({
      kind: 'refund',
      reservationId: item.reservationId!,
      label: reservation
        ? `Stand ${reservation.stand.code} · ${reservation.exhibitor.tradeName}`
        : `Reserva ${item.reservationId!.slice(0, 8)}`,
      maxCents: null,
      partialAllowed: false,
      key: crypto.randomUUID(),
    });
  }

  /** A new amount is a new request: it must not replay the previous Idempotency-Key. */
  protected changeAmount(text: string): void {
    this.amount.set(text);
    this.actionFailure.set(null);
    const current = this.pending();
    if (current) this.pending.set({ ...current, key: crypto.randomUUID() });
  }

  protected close(): void {
    this.pending.set(null);
    this.amount.set('');
    this.actionFailure.set(null);
  }

  protected confirm(): void {
    const current = this.pending();
    if (!current) return;
    const cents = this.amountCents(current);
    if (cents === 'invalid') return this.actionFailure.set(AMOUNT_INVALID);
    if (cents === 'too-high') return this.actionFailure.set(AMOUNT_TOO_HIGH);

    this.busy.set(true);
    this.actionFailure.set(null);
    const done = (status: ReservationStatus | null) => {
      this.busy.set(false);
      this.close();
      this.notice.set(this.successText(current, status));
      this.load(false);
    };
    const failed = (error: unknown) => {
      this.busy.set(false);
      this.actionFailure.set(actionError(error));
    };
    if (current.kind === 'cancel')
      this.repository.cancel(current.reservationId).subscribe({
        next: () => done(null),
        error: failed,
      });
    else
      this.repository.refund(current.reservationId, current.key, cents ?? undefined).subscribe({
        next: (result) => done(result.reservationStatus),
        error: failed,
      });
  }

  private open(pending: Pending): void {
    this.notice.set(null);
    this.amount.set('');
    this.actionFailure.set(null);
    this.pending.set(pending);
    // The safe choice gets the focus, as in a native confirm.
    afterNextRender(() => this.dismiss()?.nativeElement.focus(), { injector: this.injector });
  }

  private amountCents(pending: Pending): number | null | 'invalid' | 'too-high' {
    const text = this.amount().trim();
    if (!pending.partialAllowed || text === '') return null;
    const cents = parsePesos(text);
    if (cents === null) return 'invalid';
    return pending.maxCents !== null && cents > pending.maxCents ? 'too-high' : cents;
  }

  private successText(pending: Pending, status: ReservationStatus | null): string {
    if (pending.kind === 'cancel') return 'Reserva cancelada. El stand quedó libre.';
    if (status === 'CANCELLED') return 'Cobro y reserva cancelados.';
    if (status === 'REFUNDED') return 'Pago devuelto. El stand quedó libre.';
    return 'Pedimos la devolución a Mercado Pago. Actualizá en unos minutos para ver el resultado.';
  }

  private actionFor(r: OrganizerReservationDto, now: number): ActionKind | null {
    if (r.status === 'HELD' && isPayable(r, now)) return 'cancel';
    if (!this.canManageMoney()) return null;
    if (r.status === 'PAYMENT_PENDING') return 'cancel-payment';
    return r.status === 'CONFIRMED' ? 'refund' : null;
  }

  private when(r: OrganizerReservationDto, now: number): string {
    if (r.status === 'HELD' && r.holdExpiresAt && isPayable(r, now))
      return `Vence ${WHEN.format(new Date(r.holdExpiresAt))}`;
    if (r.status === 'CONFIRMED' && r.payment)
      return `Pagada ${DAY.format(new Date(r.payment.updatedAt))}`;
    return DAY.format(new Date(r.createdAt));
  }

  /** Events and incidents on first load; later refreshes keep the chosen event and filter. */
  private load(first: boolean): void {
    this.loading.set(true);
    this.loadError.set(null);
    forkJoin({
      events: this.repository.events(),
      incidents: this.canManageMoney()
        ? this.repository
            .incidents()
            .pipe(
              catchError((error: unknown) =>
                of<Incidents>(problemOf(error).status === 403 ? 'hidden' : 'failed'),
              ),
            )
        : of<Incidents>('hidden'),
    }).subscribe({
      next: ({ events, incidents }) => {
        const selling = events
          .filter((e) => SELLING.includes(e.status))
          .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
        this.events.set(selling);
        this.incidents.set(incidents);
        const keep = selling.some((e) => e.id === this.eventId());
        if (first || !keep) this.eventId.set(selling[0]?.id ?? null);
        this.loadReservations();
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set(LOAD_FAILED);
      },
    });
  }

  private loadReservations(): void {
    const id = this.eventId();
    if (!id) {
      this.loading.set(false);
      this.reservations.set([]);
      return;
    }
    this.loading.set(true);
    this.repository.reservations(id).subscribe({
      next: (list) => {
        this.reservations.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set(LOAD_FAILED);
      },
    });
  }
}

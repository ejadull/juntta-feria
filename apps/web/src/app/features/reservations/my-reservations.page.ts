import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal, type OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { API_BASE } from '../../shared/api/api-base';
import { formatArs } from '../../shared/money';
import type { ReservationDto } from '../checkout-return/data/reservation-payment.repository';
import { ReservationsApi } from './data/reservations.api';
import { isHistory, isPayable, statusText } from './reservation-status';

interface Row {
  readonly reservation: ReservationDto;
  readonly event: string;
  readonly status: string;
  readonly payable: boolean;
  readonly history: boolean;
  readonly holdUntil: string | null;
}

const LOAD_FAILED = 'No pudimos cargar tus reservas. Probá de nuevo en unos minutos.';

const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

/** Mis reservas (RES-01): the signed-in exhibitor's reservations, with a way to pay the live ones. */
@Component({
  selector: 'app-my-reservations-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      <p class="text-sm font-semibold tracking-wider text-primary-strong">FERIANTE</p>
      <h1 class="mt-1 text-3xl font-semibold">Mis reservas</h1>
      <p class="mt-2 text-text-muted">Tus stands, su estado de pago y cómo seguir con cada uno.</p>

      @if (error(); as message) {
        <p role="alert" class="card mt-6 text-danger">{{ message }}</p>
        <button type="button" class="btn mt-3" (click)="load()">Reintentar</button>
      } @else if (rows(); as list) {
        @if (list.length === 0) {
          <div class="card mt-6">
            <p class="font-semibold">Todavía no reservaste ningún stand</p>
            <p class="mt-1 text-sm text-text-muted">
              Elegí un stand en el plano y reservalo para verlo acá.
            </p>
            <a class="btn btn-primary mt-3" routerLink="/feriante/explorar">Explorar stands</a>
          </div>
        } @else {
          <ul class="mt-6 flex flex-col gap-3">
            @for (row of list; track row.reservation.id) {
              <li
                class="card flex flex-wrap items-center gap-x-6 gap-y-3"
                data-testid="reservation"
              >
                <div class="min-w-0 flex-1">
                  <p class="font-semibold">Stand {{ row.reservation.stand.code }}</p>
                  <p class="text-sm text-text-muted">{{ row.event }}</p>
                </div>
                <p class="font-medium">{{ price(row.reservation.amount.valueCents) }}</p>
                <div class="text-sm">
                  <p>
                    <span class="sr-only">Estado: </span><strong>{{ row.status }}</strong>
                  </p>
                  @if (row.holdUntil) {
                    <p class="text-text-muted">Vence a las {{ row.holdUntil }}</p>
                  }
                </div>
                <div class="flex flex-wrap gap-2">
                  @if (row.payable) {
                    <a
                      class="btn btn-primary"
                      routerLink="/feriante/reservas/nueva"
                      [queryParams]="{ reserva: row.reservation.id }"
                      [attr.aria-label]="'Pagar el stand ' + row.reservation.stand.code"
                      >Pagar</a
                    >
                  }
                  <a
                    class="btn"
                    [routerLink]="['/feriante/reservas', row.reservation.id, 'pago', 'pendiente']"
                    [attr.aria-label]="'Ver estado del stand ' + row.reservation.stand.code"
                    >Ver estado</a
                  >
                </div>
              </li>
            }
          </ul>
        }
      } @else {
        <p role="status" class="mt-6 text-text-muted">Cargando tus reservas…</p>
      }
    </section>
  `,
})
export class MyReservationsPage implements OnInit {
  private readonly api = inject(ReservationsApi);
  private readonly http = inject(HttpClient);

  protected readonly price = formatArs;
  protected readonly rows = signal<readonly Row[] | null>(null);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.error.set(null);
    this.rows.set(null);
    forkJoin({
      reservations: this.api.list(),
      // Event names are a nicety: without them the list still works.
      events: this.http
        .get<readonly { id: string; name: string }[]>(`${API_BASE}/events`)
        .pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ reservations, events }) => {
        const names = new Map(events.map((e) => [e.id, e.name]));
        const now = Date.now();
        this.rows.set(
          reservations
            .map((r) => ({
              reservation: r,
              event: names.get(r.eventId) ?? 'Feria',
              status: statusText(r, now),
              payable: isPayable(r, now),
              history: isHistory(r, now),
              holdUntil:
                r.status === 'HELD' && r.holdExpiresAt && isPayable(r, now)
                  ? time(r.holdExpiresAt)
                  : null,
            }))
            // Active first, history after (Array.sort is stable: each group keeps the API order).
            .sort((a, b) => Number(a.history) - Number(b.history)),
        );
      },
      error: () => this.error.set(LOAD_FAILED),
    });
  }
}

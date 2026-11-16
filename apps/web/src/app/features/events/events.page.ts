import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { messageFor } from '../../shared/auth/problem';
import { LayoutTemplatesRepository } from '../layout-editor/data/layout-templates.repository';
import { VenueRepository, type VenueDto } from '../venues/data/venue.repository';
import {
  EventAdminRepository,
  type CreateEventInput,
  type EventDto,
} from './data/event-admin.repository';
import { EVENT_STATUS, formatDate } from './labels';
import { EventForm, type PlanOption } from './ui/event-form';

const LOAD_FAILED = 'No pudimos cargar tus eventos. Probá de nuevo en unos minutos.';
const CREATE_FAILED = 'No pudimos crear el evento. Probá de nuevo en unos minutos.';
const CONFLICT =
  'Ya hay un evento con esa dirección web, o el plano ya no está publicado. Cambiá la dirección web o elegí otro plano.';
const GONE = 'El predio o el plano elegido ya no existe. Recargá la página.';
const INVALID = 'Revisá las fechas y que el plano sea del predio elegido.';

/** EVT-01 (organizer): the events of the organization and "Nuevo evento". */
@Component({
  selector: 'app-events-page',
  imports: [RouterLink, EventForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../shared/responsive-table.css',
  template: `
    <div class="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-sm font-semibold tracking-wider text-primary-strong">ORGANIZADOR</p>
          <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Eventos</h1>
          <p class="mt-2 text-text-muted">
            Cada evento parte de un plano publicado. Cargale sectores y precios, y publicalo.
          </p>
        </div>
        @if (loaded() && !formOpen()) {
          <button type="button" class="btn btn-primary" (click)="formOpen.set(true)">
            Nuevo evento
          </button>
        }
      </header>

      @if (error(); as message) {
        <p role="alert" class="mt-6 rounded-xl bg-danger/10 p-4 text-text">{{ message }}</p>
      } @else if (!loaded()) {
        <p class="mt-6 text-text-muted" aria-live="polite">Cargando tus eventos…</p>
      } @else {
        @if (formOpen()) {
          <section class="card mt-6" aria-labelledby="new-event-title">
            <h2 id="new-event-title" class="text-lg font-semibold">Nuevo evento</h2>
            @if (plans().length === 0) {
              <div class="mt-3" data-testid="needs-plan">
                <p class="text-sm text-text-muted">
                  Para crear un evento necesitás un predio y un plano publicado.
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                  @if (venues().length === 0) {
                    <a
                      class="btn btn-primary"
                      routerLink="/organizador/predios"
                      [queryParams]="{ nuevo: 1 }"
                      >Crear predio</a
                    >
                  } @else {
                    <a class="btn btn-primary" routerLink="/organizador/plano">Ir a los planos</a>
                  }
                  <button type="button" class="btn" (click)="formOpen.set(false)">Cancelar</button>
                </div>
              </div>
            } @else {
              <div class="mt-4">
                <app-event-form
                  mode="create"
                  [venues]="venues()"
                  [plans]="plans()"
                  [busy]="busy()"
                  [error]="formError()"
                  (created)="create($event)"
                  (cancelled)="formOpen.set(false)"
                />
              </div>
            }
          </section>
        }

        @if (events().length === 0) {
          <div class="card mt-6" data-testid="no-events">
            <p class="font-semibold">Todavía no hay eventos</p>
            <p class="mt-1 text-sm text-text-muted">
              Creá el primero para cargar sectores y precios y publicarlo a los feriantes.
            </p>
            @if (!formOpen()) {
              <button type="button" class="btn btn-primary mt-3" (click)="formOpen.set(true)">
                Crear el primer evento
              </button>
            }
          </div>
        } @else {
          <div
            role="region"
            tabindex="0"
            aria-label="Eventos de la organización"
            class="table-wrapper card mt-6 overflow-x-auto p-0"
          >
            <table class="stack-table w-full text-left text-sm">
              <caption class="sr-only">
                Eventos de la organización
              </caption>
              <thead class="border-b border-border text-xs tracking-wider text-text-muted">
                <tr>
                  <th scope="col" class="px-4 py-3">Evento</th>
                  <th scope="col" class="px-4 py-3">Fechas</th>
                  <th scope="col" class="px-4 py-3">Predio</th>
                  <th scope="col" class="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                @for (e of events(); track e.id) {
                  <tr data-testid="event-row">
                    <th scope="row" class="px-4 py-3 font-medium">
                      <a class="underline" [routerLink]="['/organizador/eventos', e.id]">{{
                        e.name
                      }}</a>
                    </th>
                    <td data-label="Fechas" class="px-4 py-3">
                      {{ date(e.startsAt) }} – {{ date(e.endsAt) }}
                    </td>
                    <td data-label="Predio" class="px-4 py-3">{{ venueName(e) }}</td>
                    <td data-label="Estado" class="px-4 py-3">
                      <span
                        class="rounded-full px-2 py-0.5 text-xs"
                        [class]="status[e.status].tone"
                      >
                        <span aria-hidden="true">{{ status[e.status].icon }}</span>
                        {{ status[e.status].label }}
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </div>
  `,
})
export class EventsPage {
  private readonly repository = inject(EventAdminRepository);
  private readonly router = inject(Router);

  protected readonly status = EVENT_STATUS;
  protected readonly date = formatDate;

  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly events = signal<readonly EventDto[]>([]);
  protected readonly venues = signal<readonly VenueDto[]>([]);
  protected readonly plans = signal<readonly PlanOption[]>([]);
  protected readonly formOpen = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly busy = signal(false);

  private readonly venueNames = computed(
    () => new Map(this.venues().map((v) => [v.id, v.name] as const)),
  );

  constructor() {
    const wantsNew = inject(ActivatedRoute).snapshot.queryParamMap.has('nuevo');
    forkJoin([
      this.repository.list(),
      inject(VenueRepository).list(),
      inject(LayoutTemplatesRepository).list(),
    ]).subscribe({
      next: ([events, venues, templates]) => {
        this.events.set(events);
        this.venues.set(venues);
        this.plans.set(
          templates.flatMap((t) =>
            t.versions
              .filter((v) => v.status === 'PUBLISHED')
              .map((v) => ({
                versionId: v.id,
                label: `${t.name} · versión ${v.version}`,
                venueId: t.venueId,
              })),
          ),
        );
        this.loaded.set(true);
        if (wantsNew) this.formOpen.set(true);
      },
      error: () => this.error.set(LOAD_FAILED),
    });
  }

  protected venueName(event: EventDto): string {
    return this.venueNames().get(event.venueId) ?? '—';
  }

  protected create(input: CreateEventInput): void {
    this.busy.set(true);
    this.formError.set(null);
    this.repository.create(input).subscribe({
      next: (event) => void this.router.navigate(['/organizador/eventos', event.id]),
      error: (error: unknown) => {
        this.busy.set(false);
        this.formError.set(
          messageFor(error, {}, { 409: CONFLICT, 404: GONE, 400: INVALID }, CREATE_FAILED),
        );
      },
    });
  }
}

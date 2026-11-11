import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { messageFor, problemOf, type ProblemIssue } from '../../shared/auth/problem';
import { SessionStore } from '../../shared/auth/session.store';
import { LayoutTemplatesRepository } from '../layout-editor/data/layout-templates.repository';
import { VenueRepository } from '../venues/data/venue.repository';
import {
  EventAdminRepository,
  EventPublishRejectedError,
  type EventDto,
  type UpdateEventInput,
} from './data/event-admin.repository';
import { EVENT_STATUS, formatDateTime } from './labels';
import { EventForm } from './ui/event-form';
import { SectorsPanel } from './ui/sectors-panel';
import { StandsPanel } from './ui/stands-panel';

type Tab = 'datos' | 'sectores' | 'stands';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'datos', label: 'Datos' },
  { id: 'sectores', label: 'Sectores' },
  { id: 'stands', label: 'Stands y precios' },
];

const PLAN_STATUS: Record<'DRAFT' | 'PUBLISHED' | 'ARCHIVED', string> = {
  DRAFT: 'borrador',
  PUBLISHED: 'publicada',
  ARCHIVED: 'archivada',
};

const NOT_FOUND = 'No encontramos este evento.';
const LOAD_FAILED = 'No pudimos cargar el evento. Probá de nuevo en unos minutos.';
const SAVE_FAILED = 'No pudimos guardar el evento. Probá de nuevo en unos minutos.';
const SLUG_TAKEN = 'Esa dirección web ya está en uso por otro evento.';
const INVALID = 'Revisá las fechas: el inicio va antes del fin y las ventas cierran antes del fin.';
const NOT_DRAFT = 'El evento ya no está en borrador, así que no se puede cambiar.';
const PUBLISH_FAILED = 'No pudimos publicar el evento. Probá de nuevo en unos minutos.';
const PUBLISH_FORBIDDEN = 'Publicar es una acción de propietarios y administradores.';

/** Spanish text for the machine `code` of a publish issue; the API message is only a fallback. */
export function issueText(issue: ProblemIssue): string {
  const count = issue.objectIds.length;
  switch (issue.code) {
    case 'STAND_WITHOUT_PRICE':
      return `${count === 1 ? 'Hay 1 stand sin precio' : `Hay ${count} stands sin precio`}. Todo stand que no esté deshabilitado necesita precio.`;
    case 'NO_SELLABLE_STANDS':
      return 'No hay ningún stand disponible para reservar. Dejá al menos uno en estado Disponible.';
    default:
      return issue.message;
  }
}

/** EVT-01 (organizer): one event with its data, sectors and priced stands, and "Publicar". */
@Component({
  selector: 'app-event-detail-page',
  imports: [RouterLink, EventForm, SectorsPanel, StandsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <a class="text-sm underline" routerLink="/organizador/eventos">← Eventos</a>

      @if (loadError(); as message) {
        <p role="alert" class="mt-6 rounded-xl bg-danger/10 p-4 text-text">{{ message }}</p>
      } @else if (event(); as e) {
        <header class="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="text-sm font-semibold tracking-wider text-primary-strong">
              ORGANIZADOR · EVENTO
            </p>
            <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">{{ e.name }}</h1>
            <p class="mt-2 text-text-muted">
              {{ dateTime(e.startsAt) }} – {{ dateTime(e.endsAt) }}
              @if (venueName(); as venue) {
                · {{ venue }}
              }
            </p>
          </div>
          <span class="rounded-full px-3 py-1 text-sm" [class]="status[e.status].tone">
            <span aria-hidden="true">{{ status[e.status].icon }}</span>
            {{ status[e.status].label }}
          </span>
        </header>

        @if (e.status === 'DRAFT') {
          <section class="card mt-6" aria-labelledby="publish-title">
            <h2 id="publish-title" class="text-lg font-semibold">Publicar</h2>
            <p class="mt-1 text-sm text-text-muted">
              Al publicar, los feriantes ven el evento y pueden reservar. Antes: sectores y precios
              cargados en todos los stands que no estén deshabilitados.
            </p>
            @if (session.canAdminister()) {
              @if (!confirming()) {
                <button
                  type="button"
                  class="btn btn-primary mt-4"
                  [disabled]="busy()"
                  (click)="askPublish()"
                >
                  Publicar evento
                </button>
              }
            } @else {
              <button
                type="button"
                class="btn btn-primary mt-4"
                disabled
                aria-describedby="publish-limited"
              >
                Publicar evento
              </button>
              <p
                id="publish-limited"
                class="mt-2 text-sm text-text-muted"
                data-testid="publish-limited"
              >
                Publicar es una acción de propietarios y administradores. Avisale a uno de ellos
                cuando esté todo listo.
              </p>
            }

            @if (confirming()) {
              <div
                role="alertdialog"
                aria-labelledby="publish-confirm-title"
                aria-describedby="publish-confirm-text"
                class="mt-4 rounded-lg border border-border-strong p-4"
              >
                <p id="publish-confirm-title" class="font-semibold">¿Publicar el evento?</p>
                <p id="publish-confirm-text" class="mt-1 text-sm text-text-muted">
                  Los feriantes van a poder verlo y reservar stands. Después ya no se editan sus
                  datos; los precios sí.
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn btn-primary"
                    [disabled]="busy()"
                    (click)="publish()"
                  >
                    Sí, publicar
                  </button>
                  <button #cancel type="button" class="btn" (click)="confirming.set(false)">
                    Cancelar
                  </button>
                </div>
              </div>
            }

            @if (publishIssues().length > 0) {
              <div
                role="alert"
                class="mt-4 rounded-lg bg-danger/10 p-4"
                data-testid="publish-issues"
              >
                <p class="font-semibold">No se puede publicar todavía</p>
                <ul class="mt-2 list-disc pl-5 text-sm">
                  @for (issue of publishIssues(); track issue.code) {
                    <li>{{ issueText(issue) }}</li>
                  }
                </ul>
                <button type="button" class="btn mt-3" (click)="selectTab('stands')">
                  Ir a Stands y precios
                </button>
              </div>
            } @else if (publishError(); as message) {
              <p role="alert" class="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-text">
                {{ message }}
              </p>
            }
          </section>
        } @else if (e.publishedAt; as published) {
          <p class="mt-4 text-sm text-text-muted" data-testid="published-at">
            Publicado el {{ dateTime(published) }}.
          </p>
        }

        @if (notice(); as message) {
          <p role="status" class="mt-4 rounded-lg bg-available/15 p-3 text-sm text-text">
            {{ message }}
          </p>
        }

        <div
          role="tablist"
          aria-label="Secciones del evento"
          class="mt-6 flex gap-1 overflow-x-auto border-b border-border"
        >
          @for (t of tabs; track t.id) {
            <button
              type="button"
              role="tab"
              class="tab"
              [id]="'tab-' + t.id"
              [attr.aria-selected]="tab() === t.id"
              [attr.aria-controls]="'panel-' + t.id"
              [attr.tabindex]="tab() === t.id ? 0 : -1"
              (click)="selectTab(t.id)"
              (keydown)="onTabKey($event)"
            >
              {{ t.label }}
            </button>
          }
        </div>

        <div
          role="tabpanel"
          class="mt-4"
          [id]="'panel-' + tab()"
          [attr.aria-labelledby]="'tab-' + tab()"
        >
          @switch (tab()) {
            @case ('datos') {
              <section class="card" aria-labelledby="data-title">
                <h2 id="data-title" class="text-lg font-semibold">Datos del evento</h2>
                @if (e.status !== 'DRAFT') {
                  <p class="mt-1 text-sm text-text-muted" data-testid="data-locked">
                    Solo se editan los datos de un evento en borrador.
                  </p>
                }
                <div class="mt-4">
                  <app-event-form
                    mode="edit"
                    [event]="e"
                    [disabled]="e.status !== 'DRAFT'"
                    [busy]="busy()"
                    [error]="formError()"
                    (changed)="save($event)"
                  />
                </div>
                <div class="mt-4 text-sm" data-testid="event-plan">
                  @if (plan(); as p) {
                    <p>
                      Plano del evento: <strong>{{ p.name }} · versión {{ p.version }}</strong> ({{
                        p.statusLabel
                      }}).
                    </p>
                  }
                  <p class="mt-1 text-text-muted">
                    El evento conserva la versión del plano con la que se creó. Para usar otro
                    plano,
                    <a
                      class="underline"
                      routerLink="/organizador/eventos"
                      [queryParams]="{ nuevo: 1 }"
                      >creá un evento nuevo</a
                    >.
                  </p>
                  <p class="mt-2">
                    <a
                      class="underline"
                      [routerLink]="['/organizador/layouts', e.layoutVersionId, 'editor']"
                      >Ver el plano del evento</a
                    >
                  </p>
                </div>
              </section>
            }
            @case ('sectores') {
              <div class="card"><app-sectors-panel [eventId]="e.id" /></div>
            }
            @case ('stands') {
              <div class="card">
                <app-stands-panel [eventId]="e.id" [layoutVersionId]="e.layoutVersionId" />
              </div>
            }
          }
        </div>
      } @else {
        <p class="mt-6 text-text-muted" aria-live="polite">Cargando el evento…</p>
      }
    </div>
  `,
  styles: `
    .tab {
      min-height: 2.75rem;
      padding: 0 1rem;
      border-bottom: 3px solid transparent;
      font-size: 0.9375rem;
      color: var(--color-text);
      white-space: nowrap;
    }
    .tab[aria-selected='true'] {
      border-bottom-color: var(--color-primary);
      font-weight: 600;
      color: var(--color-primary-strong);
    }
    .tab:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: -2px;
    }
  `,
})
export class EventDetailPage implements OnInit {
  /** Route parameter `:id`. */
  readonly id = input.required<string>();

  private readonly repository = inject(EventAdminRepository);
  private readonly venues = inject(VenueRepository);
  private readonly templates = inject(LayoutTemplatesRepository);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly cancel = viewChild<ElementRef<HTMLButtonElement>>('cancel');
  protected readonly session = inject(SessionStore);

  protected readonly status = EVENT_STATUS;
  protected readonly tabs = TABS;
  protected readonly dateTime = formatDateTime;
  protected readonly issueText = issueText;

  protected readonly event = signal<EventDto | null>(null);
  protected readonly venueName = signal<string | null>(null);
  /** The plan and version the event was created on (a nicety, like the venue name). */
  protected readonly plan = signal<{
    name: string;
    version: number;
    statusLabel: string;
  } | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly tab = signal<Tab>('datos');
  protected readonly busy = signal(false);
  protected readonly notice = signal('');
  protected readonly formError = signal<string | null>(null);
  protected readonly confirming = signal(false);
  protected readonly publishIssues = signal<readonly ProblemIssue[]>([]);
  protected readonly publishError = signal<string | null>(null);

  ngOnInit(): void {
    forkJoin([
      this.repository.get(this.id()),
      // The venue name is a nicety: the event still loads without it.
      this.venues.list().pipe(catchError(() => of([]))),
      this.templates.list().pipe(catchError(() => of([]))),
    ]).subscribe({
      next: ([event, venues, templates]) => {
        this.event.set(event);
        this.venueName.set(venues.find((v) => v.id === event.venueId)?.name ?? null);
        for (const template of templates) {
          const version = template.versions.find((v) => v.id === event.layoutVersionId);
          if (version)
            this.plan.set({
              name: template.name,
              version: version.version,
              statusLabel: PLAN_STATUS[version.status],
            });
        }
      },
      error: (error: unknown) =>
        this.loadError.set(problemOf(error).status === 404 ? NOT_FOUND : LOAD_FAILED),
    });
  }

  protected selectTab(tab: Tab): void {
    this.tab.set(tab);
  }

  protected onTabKey(event: KeyboardEvent): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.id === this.tab());
    const next = TABS[(index + step + TABS.length) % TABS.length];
    this.tab.set(next.id);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`#tab-${next.id}`)?.focus(),
      { injector: this.injector },
    );
  }

  protected save(patch: UpdateEventInput): void {
    if (Object.keys(patch).length === 0) {
      this.notice.set('No hay cambios para guardar.');
      return;
    }
    this.busy.set(true);
    this.formError.set(null);
    this.notice.set('');
    this.repository.update(this.id(), patch).subscribe({
      next: (event) => {
        this.busy.set(false);
        this.event.set(event);
        this.notice.set('Guardamos los cambios del evento.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.formError.set(
          messageFor(error, {}, { 409: SLUG_TAKEN, 400: INVALID, 404: NOT_FOUND }, SAVE_FAILED),
        );
      },
    });
  }

  protected askPublish(): void {
    this.publishIssues.set([]);
    this.publishError.set(null);
    this.notice.set('');
    this.confirming.set(true);
    afterNextRender(() => this.cancel()?.nativeElement.focus(), { injector: this.injector });
  }

  protected publish(): void {
    this.busy.set(true);
    this.repository.publish(this.id()).subscribe({
      next: (event) => {
        this.busy.set(false);
        this.confirming.set(false);
        this.event.set(event);
        this.notice.set('Publicamos el evento: ya lo ven los feriantes.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.confirming.set(false);
        if (error instanceof EventPublishRejectedError) this.publishIssues.set(error.issues);
        else
          this.publishError.set(
            messageFor(error, {}, { 409: NOT_DRAFT, 403: PUBLISH_FORBIDDEN }, PUBLISH_FAILED),
          );
      },
    });
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { messageFor } from '../../shared/auth/problem';
import { focusFirstInvalid, valueOf } from '../../shared/forms';
import { VenueRepository, type VenueDto } from '../venues/data/venue.repository';
import {
  LayoutTemplatesRepository,
  type LayoutTemplateDto,
} from './data/layout-templates.repository';
import type { LayoutVersionStatus } from './domain/layout.types';

const STATUS_LABEL: Record<LayoutVersionStatus, string> = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Publicada',
  ARCHIVED: 'Archivada',
};

const LOAD_FAILED = 'No pudimos cargar tus planos. Probá de nuevo en unos minutos.';
const CREATE_FAILED = 'No pudimos crear el plano. Probá de nuevo en unos minutos.';
const DUPLICATE = 'Ya tenés un plano con ese nombre.';
const VENUE_GONE = 'El predio elegido ya no existe. Elegí otro.';
const CLONE_FAILED = 'No pudimos clonar el plano. Probá de nuevo en unos minutos.';
const CLONE_GONE = 'El plano o el predio ya no existe. Recargá la página.';

type Field = 'name' | 'venue';

/** The version being cloned from the list. */
interface CloneSource {
  readonly template: LayoutTemplateDto;
  readonly version: LayoutTemplateDto['versions'][number];
}

/**
 * Entry of "Editor de plano" (LAY-01): the organization's plans with the status of each version,
 * "Nuevo plano" (choose a venue, create the template, open its first draft in the editor) and
 * "Clonar" (copy any version into a new plan, to use a changed plan in a new event: an event keeps
 * the version it was created on).
 */
@Component({
  selector: 'app-layout-entry-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-8">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-sm font-semibold tracking-wider text-primary-strong">
            ORGANIZADOR · PLANO DEL PREDIO
          </p>
          <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Editor de plano</h1>
          <p class="mt-2 text-text-muted">
            Dibujá el plano de cada predio. Un evento se crea sobre un plano publicado.
          </p>
        </div>
        @if (loaded() && venues().length > 0 && !formOpen()) {
          <button type="button" class="btn btn-primary" (click)="openForm()">Nuevo plano</button>
        }
      </header>

      @if (error(); as message) {
        <p role="alert" class="card mt-6 text-danger">{{ message }}</p>
      } @else if (!loaded()) {
        <p class="mt-6 text-text-muted" aria-live="polite">Cargando tus planos…</p>
      } @else {
        @if (venues().length === 0) {
          <div class="card mt-6" data-testid="no-venues">
            <p class="font-semibold">Primero necesitás un predio</p>
            <p class="mt-1 text-sm text-text-muted">
              Cada plano se dibuja sobre un predio. Creá el primero y volvé acá.
            </p>
            <a
              class="btn btn-primary mt-4"
              routerLink="/organizador/predios"
              [queryParams]="{ nuevo: 1 }"
              >Crear predio</a
            >
          </div>
        }

        @if (formOpen()) {
          <form
            #form
            class="card mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
            novalidate
            aria-labelledby="plan-form-title"
            (submit)="create($event)"
          >
            <h2 id="plan-form-title" class="text-lg font-semibold sm:col-span-2">Nuevo plano</h2>
            <label class="grid gap-1 text-sm">
              <span>Nombre del plano</span>
              <input
                class="field"
                type="text"
                autocomplete="off"
                [attr.aria-invalid]="errors().name ? 'true' : null"
                [attr.aria-describedby]="errors().name ? 'plan-name-error' : null"
                [value]="name()"
                (input)="name.set(valueOf($event))"
              />
              @if (errors().name; as message) {
                <span id="plan-name-error" class="text-danger">{{ message }}</span>
              }
            </label>
            <label class="grid gap-1 text-sm">
              <span>Predio</span>
              <select
                class="field"
                [attr.aria-invalid]="errors().venue ? 'true' : null"
                [attr.aria-describedby]="errors().venue ? 'plan-venue-error' : null"
                (change)="venueId.set(valueOf($event))"
              >
                <option value="" [selected]="venueId() === ''">Elegí un predio</option>
                @for (v of venues(); track v.id) {
                  <option [value]="v.id" [selected]="v.id === venueId()">{{ v.name }}</option>
                }
              </select>
              @if (errors().venue; as message) {
                <span id="plan-venue-error" class="text-danger">{{ message }}</span>
              }
            </label>
            @if (formError(); as message) {
              <p role="alert" class="rounded-lg bg-danger/10 p-3 text-sm text-text sm:col-span-2">
                {{ message }}
              </p>
            }
            <div class="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" class="btn btn-primary" [disabled]="busy()">
                Crear y abrir el editor
              </button>
              <button type="button" class="btn" (click)="formOpen.set(false)">Cancelar</button>
            </div>
          </form>
        }

        @if (cloning(); as source) {
          <form
            #cloneForm
            class="card mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
            novalidate
            aria-labelledby="clone-form-title"
            (submit)="clone($event)"
          >
            <h2 id="clone-form-title" class="text-lg font-semibold sm:col-span-2">
              Clonar {{ source.template.name }} · versión {{ source.version.version }}
            </h2>
            <p class="text-sm text-text-muted sm:col-span-2">
              Se crea un plano nuevo con una copia de esta versión, en borrador. El plano original y
              los eventos que lo usan no cambian.
            </p>
            <label class="grid gap-1 text-sm">
              <span>Nombre del plano nuevo</span>
              <input
                class="field"
                type="text"
                autocomplete="off"
                [attr.aria-invalid]="errors().name ? 'true' : null"
                [attr.aria-describedby]="errors().name ? 'clone-name-error' : null"
                [value]="name()"
                (input)="name.set(valueOf($event))"
              />
              @if (errors().name; as message) {
                <span id="clone-name-error" class="text-danger">{{ message }}</span>
              }
            </label>
            <label class="grid gap-1 text-sm">
              <span>Predio</span>
              <select
                class="field"
                [attr.aria-invalid]="errors().venue ? 'true' : null"
                [attr.aria-describedby]="errors().venue ? 'clone-venue-error' : null"
                (change)="venueId.set(valueOf($event))"
              >
                <option value="" [selected]="venueId() === ''">Elegí un predio</option>
                @for (v of venues(); track v.id) {
                  <option [value]="v.id" [selected]="v.id === venueId()">{{ v.name }}</option>
                }
              </select>
              @if (errors().venue; as message) {
                <span id="clone-venue-error" class="text-danger">{{ message }}</span>
              }
            </label>
            @if (formError(); as message) {
              <p role="alert" class="rounded-lg bg-danger/10 p-3 text-sm text-text sm:col-span-2">
                {{ message }}
              </p>
            }
            <div class="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" class="btn btn-primary" [disabled]="busy()">
                Clonar y abrir el editor
              </button>
              <button type="button" class="btn" (click)="cloning.set(null)">Cancelar</button>
            </div>
          </form>
        }

        @if (venues().length > 0 && templates().length === 0) {
          <div class="card mt-6" data-testid="no-layout">
            <p class="font-semibold">Todavía no hay planos</p>
            <p class="mt-1 text-sm text-text-muted">
              Creá el primero: se abre en el editor como borrador y lo publicás cuando esté listo.
            </p>
          </div>
        }

        <ul class="mt-6 grid gap-4" aria-label="Planos">
          @for (t of templates(); track t.id) {
            <li class="card" data-testid="template-row">
              <h2 class="text-lg font-semibold">{{ t.name }}</h2>
              <p class="text-sm text-text-muted">Predio: {{ venueName(t) }}</p>
              <ul class="mt-3 flex flex-wrap gap-2">
                @for (v of t.versions; track v.id) {
                  <li class="flex flex-wrap gap-1">
                    <a
                      class="btn"
                      [routerLink]="['/organizador/layouts', v.id, 'editor']"
                      [attr.data-status]="v.status"
                    >
                      Abrir versión {{ v.version }} · {{ statusLabel[v.status] }}
                    </a>
                    <button type="button" class="btn" (click)="openClone(t, v)">
                      Clonar versión {{ v.version }}
                    </button>
                  </li>
                }
              </ul>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class LayoutEntryPage {
  private readonly venueRepository = inject(VenueRepository);
  private readonly templateRepository = inject(LayoutTemplatesRepository);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly form = viewChild<ElementRef<HTMLFormElement>>('form');
  private readonly cloneForm = viewChild<ElementRef<HTMLFormElement>>('cloneForm');

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly valueOf = valueOf;

  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly venues = signal<readonly VenueDto[]>([]);
  protected readonly templates = signal<readonly LayoutTemplateDto[]>([]);

  protected readonly formOpen = signal(false);
  protected readonly cloning = signal<CloneSource | null>(null);
  protected readonly name = signal('');
  protected readonly venueId = signal('');
  protected readonly errors = signal<Partial<Record<Field, string>>>({});
  protected readonly formError = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    const wantsNew = inject(ActivatedRoute).snapshot.queryParamMap.has('nuevo');
    forkJoin([this.venueRepository.list(), this.templateRepository.list()]).subscribe({
      next: ([venues, templates]) => {
        this.venues.set(venues);
        this.templates.set(templates);
        this.loaded.set(true);
        if (wantsNew && venues.length > 0) this.openForm();
      },
      error: () => this.error.set(LOAD_FAILED),
    });
  }

  protected venueName(template: LayoutTemplateDto): string {
    return this.venues().find((v) => v.id === template.venueId)?.name ?? 'Sin predio';
  }

  protected openClone(template: LayoutTemplateDto, version: CloneSource['version']): void {
    this.formOpen.set(false);
    this.name.set(`${template.name} (copia)`);
    this.venueId.set(template.venueId ?? (this.venues().length === 1 ? this.venues()[0].id : ''));
    this.errors.set({});
    this.formError.set(null);
    this.busy.set(false);
    this.cloning.set({ template, version });
  }

  protected openForm(): void {
    this.cloning.set(null);
    this.name.set('');
    this.venueId.set(this.venues().length === 1 ? this.venues()[0].id : '');
    this.errors.set({});
    this.formError.set(null);
    this.formOpen.set(true);
  }

  /** Validates the shared name/venue fields; focuses the first invalid one and returns null. */
  private validated(form: ElementRef<HTMLFormElement> | undefined): string | null {
    const name = this.name().trim();
    const errors: Partial<Record<Field, string>> = {};
    if (!name) errors.name = 'Ingresá el nombre del plano.';
    else if (name.length > 120) errors.name = 'Usá como máximo 120 caracteres.';
    if (!this.venueId()) errors.venue = 'Elegí el predio del plano.';
    this.errors.set(errors);
    if (Object.keys(errors).length === 0) return name;
    if (form) focusFirstInvalid(this.injector, form.nativeElement);
    return null;
  }

  protected clone(event: Event): void {
    event.preventDefault();
    const source = this.cloning();
    const name = this.validated(this.cloneForm());
    if (!source || name === null) return;
    this.busy.set(true);
    this.formError.set(null);
    this.templateRepository
      .clone(source.template.id, {
        name,
        sourceVersionId: source.version.id,
        venueId: this.venueId(),
      })
      .subscribe({
        next: (draft) => void this.router.navigate(['/organizador/layouts', draft.id, 'editor']),
        error: (error: unknown) => {
          this.busy.set(false);
          this.formError.set(
            messageFor(error, {}, { 409: DUPLICATE, 404: CLONE_GONE }, CLONE_FAILED),
          );
        },
      });
  }

  protected create(event: Event): void {
    event.preventDefault();
    const name = this.validated(this.form());
    if (name === null) return;
    this.busy.set(true);
    this.formError.set(null);
    this.templateRepository.create({ name, venueId: this.venueId() }).subscribe({
      next: (draft) => void this.router.navigate(['/organizador/layouts', draft.id, 'editor']),
      error: (error: unknown) => {
        this.busy.set(false);
        this.formError.set(
          messageFor(error, {}, { 409: DUPLICATE, 404: VENUE_GONE }, CREATE_FAILED),
        );
      },
    });
  }
}

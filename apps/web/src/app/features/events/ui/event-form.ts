import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { focusFirstInvalid, valueOf } from '../../../shared/forms';
import type { CreateEventInput, EventDto, UpdateEventInput } from '../data/event-admin.repository';
import {
  dateErrors,
  isoToLocal,
  localToIso,
  type DateField,
  type DateTexts,
} from '../domain/event-dates';

const SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const DATE_FIELDS: readonly { readonly key: DateField; readonly label: string }[] = [
  { key: 'startsAt', label: 'Inicio del evento' },
  { key: 'endsAt', label: 'Fin del evento' },
  { key: 'salesOpenAt', label: 'Apertura de ventas' },
  { key: 'salesCloseAt', label: 'Cierre de ventas' },
];

/** A published plan an event can be created on. */
export interface PlanOption {
  readonly versionId: string;
  readonly label: string;
  /** The venue the template is tied to; null serves any venue. */
  readonly venueId: string | null;
}

export interface VenueOption {
  readonly id: string;
  readonly name: string;
}

type Field = 'name' | 'slug' | 'venue' | 'plan' | DateField;
type Errors = Partial<Record<Field, string>>;

/**
 * Event fields (EVT-01): used to create an event (venue and published plan included) and to edit a
 * draft. Dates are typed in Argentina time and sent with their offset.
 */
@Component({
  selector: 'app-event-form',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form
      #form
      class="grid grid-cols-1 gap-4 sm:grid-cols-2"
      novalidate
      [attr.aria-label]="mode() === 'create' ? 'Nuevo evento' : 'Datos del evento'"
      (submit)="submit($event)"
    >
      <label class="grid gap-1 text-sm">
        <span>Nombre</span>
        <input
          class="field"
          type="text"
          autocomplete="off"
          [disabled]="disabled()"
          [attr.aria-invalid]="errors().name ? 'true' : null"
          [attr.aria-describedby]="errors().name ? 'event-name-error' : null"
          [value]="name()"
          (input)="name.set(valueOf($event))"
        />
        @if (errors().name; as message) {
          <span id="event-name-error" class="text-danger">{{ message }}</span>
        }
      </label>

      <label class="grid gap-1 text-sm">
        <span>Dirección web (opcional)</span>
        <input
          class="field"
          type="text"
          autocomplete="off"
          aria-describedby="event-slug-hint"
          [disabled]="disabled()"
          [attr.aria-invalid]="errors().slug ? 'true' : null"
          [value]="slug()"
          (input)="slug.set(valueOf($event))"
        />
        <span id="event-slug-hint" class="text-xs text-text-muted">
          Se arma con el nombre si lo dejás vacío. Solo minúsculas, números y guiones.
        </span>
        @if (errors().slug; as message) {
          <span class="text-danger">{{ message }}</span>
        }
      </label>

      @if (mode() === 'create') {
        <label class="grid gap-1 text-sm">
          <span>Predio</span>
          <select
            class="field"
            [attr.aria-invalid]="errors().venue ? 'true' : null"
            [attr.aria-describedby]="errors().venue ? 'event-venue-error' : null"
            (change)="chooseVenue(valueOf($event))"
          >
            <option value="" [selected]="venueId() === ''">Elegí un predio</option>
            @for (v of venues(); track v.id) {
              <option [value]="v.id" [selected]="v.id === venueId()">{{ v.name }}</option>
            }
          </select>
          @if (errors().venue; as message) {
            <span id="event-venue-error" class="text-danger">{{ message }}</span>
          }
        </label>

        <label class="grid gap-1 text-sm">
          <span>Plano publicado</span>
          <select
            class="field"
            aria-describedby="event-plan-hint"
            [attr.aria-invalid]="errors().plan ? 'true' : null"
            (change)="versionId.set(valueOf($event))"
          >
            <option value="" [selected]="versionId() === ''">Elegí un plano</option>
            @for (p of plansForVenue(); track p.versionId) {
              <option [value]="p.versionId" [selected]="p.versionId === versionId()">
                {{ p.label }}
              </option>
            }
          </select>
          <span id="event-plan-hint" class="text-xs text-text-muted">
            Solo aparecen planos publicados del predio elegido. El evento conserva esa versión del
            plano: para usar un plano modificado, creá un evento nuevo.
            @if (venueId() !== '' && plansForVenue().length === 0) {
              No hay ninguno todavía:
              <a class="underline" routerLink="/organizador/plano">publicá un plano</a>.
            }
          </span>
          @if (errors().plan; as message) {
            <span class="text-danger">{{ message }}</span>
          }
        </label>
      }

      @for (f of dateFields; track f.key) {
        <label class="grid gap-1 text-sm">
          <span>{{ f.label }}</span>
          <input
            class="field"
            type="datetime-local"
            [disabled]="disabled()"
            [attr.aria-invalid]="errors()[f.key] ? 'true' : null"
            [attr.aria-describedby]="errors()[f.key] ? 'event-' + f.key + '-error' : null"
            [value]="dates()[f.key]"
            (input)="setDate(f.key, valueOf($event))"
          />
          @if (errors()[f.key]; as message) {
            <span [id]="'event-' + f.key + '-error'" class="text-danger">{{ message }}</span>
          }
        </label>
      }
      <p class="text-xs text-text-muted sm:col-span-2">
        Horario de Argentina (UTC-3). Las ventas tienen que cerrar antes de que termine el evento.
      </p>

      @if (error(); as message) {
        <p role="alert" class="rounded-lg bg-danger/10 p-3 text-sm text-text sm:col-span-2">
          {{ message }}
        </p>
      }

      <div class="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" class="btn btn-primary" [disabled]="busy() || disabled()">
          {{ mode() === 'create' ? 'Crear evento' : 'Guardar cambios' }}
        </button>
        @if (mode() === 'create') {
          <button type="button" class="btn" (click)="cancelled.emit()">Cancelar</button>
        }
      </div>
    </form>
  `,
})
export class EventForm implements OnInit {
  readonly mode = input<'create' | 'edit'>('create');
  /** The event being edited. */
  readonly event = input<EventDto | null>(null);
  readonly venues = input<readonly VenueOption[]>([]);
  readonly plans = input<readonly PlanOption[]>([]);
  readonly busy = input(false);
  readonly disabled = input(false);
  /** Failure of the last save, already in Spanish. */
  readonly error = input<string | null>(null);

  readonly created = output<CreateEventInput>();
  readonly changed = output<UpdateEventInput>();
  readonly cancelled = output<void>();

  private readonly injector = inject(Injector);
  private readonly form = viewChild<ElementRef<HTMLFormElement>>('form');
  protected readonly valueOf = valueOf;
  protected readonly dateFields = DATE_FIELDS;

  protected readonly name = signal('');
  protected readonly slug = signal('');
  protected readonly venueId = signal('');
  protected readonly versionId = signal('');
  protected readonly dates = signal<DateTexts>({
    startsAt: '',
    endsAt: '',
    salesOpenAt: '',
    salesCloseAt: '',
  });
  protected readonly errors = signal<Errors>({});

  protected readonly plansForVenue = computed(() =>
    this.plans().filter(
      (p) => this.venueId() !== '' && (p.venueId === null || p.venueId === this.venueId()),
    ),
  );

  ngOnInit(): void {
    const event = this.event();
    if (this.mode() === 'edit' && event) {
      this.name.set(event.name);
      this.slug.set(event.slug);
      this.dates.set({
        startsAt: isoToLocal(event.startsAt),
        endsAt: isoToLocal(event.endsAt),
        salesOpenAt: isoToLocal(event.salesOpenAt),
        salesCloseAt: isoToLocal(event.salesCloseAt),
      });
    } else if (this.venues().length === 1) {
      this.venueId.set(this.venues()[0].id);
    }
  }

  protected chooseVenue(id: string): void {
    this.venueId.set(id);
    if (!this.plansForVenue().some((p) => p.versionId === this.versionId())) this.versionId.set('');
  }

  protected setDate(field: DateField, value: string): void {
    this.dates.update((d) => ({ ...d, [field]: value }));
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const errors = this.validate();
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) {
      const host = this.form()?.nativeElement;
      if (host) focusFirstInvalid(this.injector, host);
      return;
    }
    const iso = (f: DateField): string => localToIso(this.dates()[f]) ?? '';
    const name = this.name().trim();
    const slug = this.slug().trim();
    const current = this.event();
    if (this.mode() === 'create') {
      this.created.emit({
        venueId: this.venueId(),
        layoutVersionId: this.versionId(),
        name,
        ...(slug && { slug }),
        startsAt: iso('startsAt'),
        endsAt: iso('endsAt'),
        salesOpenAt: iso('salesOpenAt'),
        salesCloseAt: iso('salesCloseAt'),
      });
    } else if (current) {
      const patch: Record<string, string> = {};
      if (name !== current.name) patch['name'] = name;
      if (slug && slug !== current.slug) patch['slug'] = slug;
      for (const f of DATE_FIELDS)
        if (Date.parse(iso(f.key)) !== Date.parse(current[f.key])) patch[f.key] = iso(f.key);
      this.changed.emit(patch);
    }
  }

  private validate(): Errors {
    const errors: Errors = { ...dateErrors(this.dates()) };
    const name = this.name().trim();
    const slug = this.slug().trim();
    if (!name) errors.name = 'Ingresá el nombre del evento.';
    else if (name.length > 120) errors.name = 'Usá como máximo 120 caracteres.';
    if (slug && (slug.length > 80 || !SLUG_SHAPE.test(slug)))
      errors.slug = 'Usá minúsculas, números y guiones (hasta 80 caracteres).';
    if (this.mode() === 'create') {
      if (!this.venueId()) errors.venue = 'Elegí el predio del evento.';
      if (!this.versionId()) errors.plan = 'Elegí un plano publicado.';
    }
    return errors;
  }
}

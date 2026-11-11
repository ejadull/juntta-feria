import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { messageFor } from '../../shared/auth/problem';
import { SessionStore } from '../../shared/auth/session.store';
import { centsToInput, parseDecimal } from '../../shared/decimal';
import { focusFirstInvalid, valueOf } from '../../shared/forms';
import {
  VenueRepository,
  type VenueDto,
  type VenueInput,
  type VenueType,
} from './data/venue.repository';

const TYPE_LABEL: Record<VenueType, string> = { FIXED: 'Fijo', TEMPORARY: 'Temporal' };
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
const MAX_METERS = 100_000;

const LOAD_FAILED = 'No pudimos cargar los predios. Probá de nuevo en unos minutos.';
const SAVE_FAILED = 'No pudimos guardar el predio. Probá de nuevo en unos minutos.';
const DUPLICATE = 'Ya tenés un predio con ese nombre.';
const REMOVE_FAILED = 'No pudimos eliminar el predio. Probá de nuevo en unos minutos.';
const IN_USE = 'No se puede eliminar: hay planos o eventos que usan este predio.';

type Field = 'name' | 'address' | 'timezone' | 'widthM' | 'heightM';
type Errors = Partial<Record<Field, string>>;

const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('es-AR', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const meters = (text: string): number | null => {
  const value = parseDecimal(text);
  return value !== null && value > 0 && value <= MAX_METERS ? value : null;
};

/** VEN-01 (organizer): venues of the organization. Delete is OWNER/ADMIN only, like the API. */
@Component({
  selector: 'app-venues-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-sm font-semibold tracking-wider text-primary-strong">ORGANIZADOR</p>
          <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Predios</h1>
          <p class="mt-2 text-text-muted">
            El lugar donde se arma la feria. Cada plano y cada evento parten de un predio.
          </p>
        </div>
        @if (!formOpen()) {
          <button type="button" class="btn btn-primary" (click)="openCreate()">Nuevo predio</button>
        }
      </header>

      @if (formOpen()) {
        <form
          #form
          class="card mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
          novalidate
          aria-labelledby="venue-form-title"
          (submit)="save($event)"
        >
          <h2 id="venue-form-title" class="text-lg font-semibold sm:col-span-2">
            {{ editingId() ? 'Editar predio' : 'Nuevo predio' }}
          </h2>

          <label class="grid gap-1 text-sm">
            <span>Nombre</span>
            <input
              class="field"
              type="text"
              autocomplete="off"
              [attr.aria-invalid]="errors().name ? 'true' : null"
              [attr.aria-describedby]="errors().name ? 'venue-name-error' : null"
              [value]="name()"
              (input)="name.set(valueOf($event))"
            />
            @if (errors().name; as message) {
              <span id="venue-name-error" class="text-danger">{{ message }}</span>
            }
          </label>

          <label class="grid gap-1 text-sm">
            <span>Tipo</span>
            <select class="field" (change)="type.set($any(valueOf($event)))">
              @for (t of types; track t) {
                <option [value]="t" [selected]="t === type()">{{ typeLabel[t] }}</option>
              }
            </select>
          </label>

          <label class="grid gap-1 text-sm sm:col-span-2">
            <span>Dirección (opcional)</span>
            <input
              class="field"
              type="text"
              autocomplete="off"
              [attr.aria-invalid]="errors().address ? 'true' : null"
              [attr.aria-describedby]="errors().address ? 'venue-address-error' : null"
              [value]="address()"
              (input)="address.set(valueOf($event))"
            />
            @if (errors().address; as message) {
              <span id="venue-address-error" class="text-danger">{{ message }}</span>
            }
          </label>

          <label class="grid gap-1 text-sm">
            <span>Ancho (m)</span>
            <input
              class="field"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              [attr.aria-invalid]="errors().widthM ? 'true' : null"
              [attr.aria-describedby]="errors().widthM ? 'venue-width-error' : null"
              [value]="widthM()"
              (input)="widthM.set(valueOf($event))"
            />
            @if (errors().widthM; as message) {
              <span id="venue-width-error" class="text-danger">{{ message }}</span>
            }
          </label>

          <label class="grid gap-1 text-sm">
            <span>Largo (m)</span>
            <input
              class="field"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              [attr.aria-invalid]="errors().heightM ? 'true' : null"
              [attr.aria-describedby]="errors().heightM ? 'venue-height-error' : null"
              [value]="heightM()"
              (input)="heightM.set(valueOf($event))"
            />
            @if (errors().heightM; as message) {
              <span id="venue-height-error" class="text-danger">{{ message }}</span>
            }
          </label>

          <label class="grid gap-1 text-sm sm:col-span-2">
            <span>Zona horaria</span>
            <input
              class="field"
              type="text"
              autocomplete="off"
              aria-describedby="venue-timezone-hint"
              [attr.aria-invalid]="errors().timezone ? 'true' : null"
              [value]="timezone()"
              (input)="timezone.set(valueOf($event))"
            />
            <span id="venue-timezone-hint" class="text-xs text-text-muted">
              Nombre IANA, por ejemplo America/Argentina/Buenos_Aires.
            </span>
            @if (errors().timezone; as message) {
              <span class="text-danger">{{ message }}</span>
            }
          </label>

          @if (formError(); as message) {
            <p role="alert" class="rounded-lg bg-danger/10 p-3 text-sm text-text sm:col-span-2">
              {{ message }}
            </p>
          }

          <div class="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" class="btn btn-primary" [disabled]="busy()">
              {{ editingId() ? 'Guardar cambios' : 'Crear predio' }}
            </button>
            <button type="button" class="btn" (click)="closeForm()">Cancelar</button>
          </div>
        </form>
      }

      @if (notice(); as message) {
        <p role="status" class="mt-4 rounded-lg bg-available/15 p-3 text-sm text-text">
          {{ message }}
        </p>
      }
      @if (actionError(); as message) {
        <p role="alert" class="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-text">{{ message }}</p>
      }
      @if (listError(); as message) {
        <p role="alert" class="mt-6 rounded-xl bg-danger/10 p-4 text-text">{{ message }}</p>
      } @else if (list(); as rows) {
        @if (rows.length === 0) {
          <div class="card mt-6" data-testid="no-venues">
            <p class="font-semibold">Todavía no hay predios</p>
            <p class="mt-1 text-sm text-text-muted">
              Creá el primero para poder dibujar su plano y armar un evento.
            </p>
          </div>
        } @else {
          <div class="card mt-6 overflow-x-auto p-0">
            <table class="w-full text-left text-sm">
              <caption class="sr-only">
                Predios de la organización
              </caption>
              <thead class="border-b border-border text-xs tracking-wider text-text-muted">
                <tr>
                  <th scope="col" class="px-4 py-3">Nombre</th>
                  <th scope="col" class="px-4 py-3">Tipo</th>
                  <th scope="col" class="px-4 py-3">Dirección</th>
                  <th scope="col" class="px-4 py-3">Medidas</th>
                  <th scope="col" class="px-4 py-3"><span class="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                @for (v of rows; track v.id) {
                  <tr data-testid="venue-row">
                    <th scope="row" class="px-4 py-3 font-medium">{{ v.name }}</th>
                    <td class="px-4 py-3">{{ typeLabel[v.type] }}</td>
                    <td class="px-4 py-3">{{ v.address ?? '—' }}</td>
                    <td class="px-4 py-3">{{ size(v) }}</td>
                    <td class="px-4 py-3">
                      <div class="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          class="btn"
                          [attr.aria-label]="'Editar ' + v.name"
                          (click)="openEdit(v)"
                        >
                          Editar
                        </button>
                        @if (session.canAdminister()) {
                          <button
                            type="button"
                            class="btn btn-danger"
                            [attr.aria-label]="'Eliminar ' + v.name"
                            (click)="askRemove(v)"
                          >
                            Eliminar
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (!session.canAdminister()) {
            <p class="mt-3 text-xs text-text-muted" data-testid="remove-limited">
              Eliminar un predio es una acción de propietarios y administradores.
            </p>
          }
        }
      } @else {
        <p class="mt-6 text-text-muted" aria-live="polite">Cargando predios…</p>
      }

      @if (removing(); as target) {
        <div
          role="alertdialog"
          aria-labelledby="remove-title"
          aria-describedby="remove-text"
          class="card mt-4 border-border-strong"
        >
          <p id="remove-title" class="font-semibold">¿Eliminar {{ target.name }}?</p>
          <p id="remove-text" class="mt-1 text-sm text-text-muted">
            No se puede deshacer. Si hay planos o eventos que usan este predio, no se elimina.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-danger"
              [disabled]="busy()"
              (click)="remove(target)"
            >
              Sí, eliminar
            </button>
            <button #cancel type="button" class="btn" (click)="removing.set(null)">Cancelar</button>
          </div>
        </div>
      }
    </div>
  `,
})
export class VenuesPage {
  private readonly repository = inject(VenueRepository);
  private readonly injector = inject(Injector);
  private readonly form = viewChild<ElementRef<HTMLFormElement>>('form');
  private readonly cancel = viewChild<ElementRef<HTMLButtonElement>>('cancel');
  protected readonly session = inject(SessionStore);

  protected readonly types: readonly VenueType[] = ['FIXED', 'TEMPORARY'];
  protected readonly typeLabel = TYPE_LABEL;
  protected readonly valueOf = valueOf;

  protected readonly list = signal<readonly VenueDto[] | null>(null);
  protected readonly listError = signal<string | null>(null);
  protected readonly notice = signal('');
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly removing = signal<VenueDto | null>(null);

  protected readonly formOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly name = signal('');
  protected readonly type = signal<VenueType>('FIXED');
  protected readonly address = signal('');
  protected readonly timezone = signal(DEFAULT_TIMEZONE);
  protected readonly widthM = signal('');
  protected readonly heightM = signal('');
  protected readonly errors = signal<Errors>({});
  protected readonly formError = signal<string | null>(null);

  constructor() {
    this.load();
    if (inject(ActivatedRoute).snapshot.queryParamMap.has('nuevo')) this.openCreate();
  }

  protected size(v: VenueDto): string {
    return `${centsToInput(v.widthM * 100)} × ${centsToInput(v.heightM * 100)} m`;
  }

  protected openCreate(): void {
    this.name.set('');
    this.type.set('FIXED');
    this.address.set('');
    this.timezone.set(DEFAULT_TIMEZONE);
    this.widthM.set('');
    this.heightM.set('');
    this.reset(null);
  }

  protected openEdit(venue: VenueDto): void {
    this.name.set(venue.name);
    this.type.set(venue.type);
    this.address.set(venue.address ?? '');
    this.timezone.set(venue.timezone);
    this.widthM.set(centsToInput(venue.widthM * 100));
    this.heightM.set(centsToInput(venue.heightM * 100));
    this.reset(venue.id);
    afterNextRender(() => this.form()?.nativeElement.querySelector('input')?.focus(), {
      injector: this.injector,
    });
  }

  protected closeForm(): void {
    this.formOpen.set(false);
  }

  protected save(event: Event): void {
    event.preventDefault();
    const input = this.validate();
    if (!input) return;
    const id = this.editingId();
    this.busy.set(true);
    this.formError.set(null);
    (id ? this.repository.update(id, input) : this.repository.create(input)).subscribe({
      next: () => {
        this.busy.set(false);
        this.formOpen.set(false);
        this.notice.set(id ? 'Guardamos los cambios del predio.' : 'Creamos el predio.');
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.formError.set(messageFor(error, {}, { 409: DUPLICATE }, SAVE_FAILED));
      },
    });
  }

  protected askRemove(venue: VenueDto): void {
    this.removing.set(venue);
    afterNextRender(() => this.cancel()?.nativeElement.focus(), { injector: this.injector });
  }

  protected remove(venue: VenueDto): void {
    this.busy.set(true);
    this.repository.remove(venue.id).subscribe({
      next: () => this.afterRemove('Eliminamos el predio.', null),
      error: (error: unknown) =>
        this.afterRemove('', messageFor(error, {}, { 409: IN_USE }, REMOVE_FAILED)),
    });
  }

  private afterRemove(notice: string, problem: string | null): void {
    this.busy.set(false);
    this.removing.set(null);
    this.notice.set(notice);
    this.actionError.set(problem);
    this.load();
  }

  private reset(editingId: string | null): void {
    this.editingId.set(editingId);
    this.errors.set({});
    this.formError.set(null);
    this.formOpen.set(true);
  }

  private validate(): VenueInput | null {
    const errors: Errors = {};
    const name = this.name().trim();
    const address = this.address().trim();
    const timezone = this.timezone().trim();
    const widthM = meters(this.widthM());
    const heightM = meters(this.heightM());
    if (!name) errors.name = 'Ingresá el nombre del predio.';
    else if (name.length > 120) errors.name = 'Usá como máximo 120 caracteres.';
    if (address.length > 300) errors.address = 'Usá como máximo 300 caracteres.';
    if (widthM === null) errors.widthM = 'Ingresá un ancho mayor a 0, con hasta 2 decimales.';
    if (heightM === null) errors.heightM = 'Ingresá un largo mayor a 0, con hasta 2 decimales.';
    if (!timezone || !isTimeZone(timezone)) errors.timezone = 'Ingresá una zona horaria válida.';
    this.errors.set(errors);
    if (Object.keys(errors).length > 0 || widthM === null || heightM === null) {
      const host = this.form()?.nativeElement;
      if (host) focusFirstInvalid(this.injector, host);
      return null;
    }
    return { type: this.type(), name, address: address || null, timezone, widthM, heightM };
  }

  private load(): void {
    this.repository.list().subscribe({
      next: (rows) => {
        this.listError.set(null);
        this.list.set(rows);
      },
      error: () => this.listError.set(LOAD_FAILED),
    });
  }
}

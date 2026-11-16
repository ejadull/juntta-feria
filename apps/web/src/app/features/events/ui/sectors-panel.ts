import { ConfirmDialog } from '../../../shared/confirm-dialog';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  viewChild,
  type WritableSignal,
} from '@angular/core';
import type { Observable } from 'rxjs';
import { messageFor } from '../../../shared/auth/problem';
import { focusFirstInvalid, valueOf } from '../../../shared/forms';
import { EventInventoryRepository, type SectorDto } from '../data/event-inventory.repository';

const LOAD_FAILED = 'No pudimos cargar los sectores. Probá de nuevo en unos minutos.';
const SAVE_FAILED = 'No pudimos guardar el sector. Probá de nuevo en unos minutos.';
const DUPLICATE = 'Ya hay un sector con ese nombre en este evento.';
const REMOVE_FAILED = 'No pudimos eliminar el sector. Probá de nuevo en unos minutos.';
const MAX_ORDER = 1000;

type Errors = Partial<Record<'name' | 'order', string>>;

interface Parsed {
  readonly name: string;
  readonly sortOrder?: number;
}

/** "Sectores" tab (ADR 0002): sectors belong to the event; its stands point at them. */
@Component({
  selector: 'app-sectors-panel',
  imports: [ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="sectors-title">
      <h2 id="sectors-title" class="text-lg font-semibold">Sectores</h2>
      <p class="mt-1 text-sm text-text-muted">
        Agrupá los stands por zona (gastronomía, diseño…). Los feriantes los ven al elegir su stand.
      </p>

      <form
        #form
        class="mt-4 grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_8rem_auto]"
        novalidate
        (submit)="create($event)"
      >
        <div class="grid gap-1 text-sm">
          <label class="grid gap-1">
            <span>Nombre del sector</span>
            <input
              class="field"
              type="text"
              autocomplete="off"
              [attr.aria-invalid]="errors().name ? 'true' : null"
              [attr.aria-describedby]="errors().name ? 'sector-name-error' : null"
              [value]="name()"
              (input)="name.set(valueOf($event))"
            />
          </label>
          @if (errors().name; as message) {
            <span id="sector-name-error" class="text-danger">{{ message }}</span>
          }
        </div>
        <div class="grid gap-1 text-sm">
          <label class="grid gap-1">
            <span>Orden</span>
            <input
              class="field"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              [attr.aria-invalid]="errors().order ? 'true' : null"
              [attr.aria-describedby]="errors().order ? 'sector-order-error' : null"
              [value]="order()"
              (input)="order.set(valueOf($event))"
            />
          </label>
          @if (errors().order; as message) {
            <span id="sector-order-error" class="text-danger">{{ message }}</span>
          }
        </div>
        <button type="submit" class="btn btn-primary sm:mt-6" [disabled]="busy()">
          Agregar sector
        </button>
      </form>

      @if (formError(); as message) {
        <p role="alert" class="mt-3 rounded-lg bg-danger/10 p-3 text-sm text-text">{{ message }}</p>
      }

      @if (loadError(); as message) {
        <p role="alert" class="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-text">{{ message }}</p>
      } @else if (list(); as rows) {
        @if (rows.length === 0) {
          <p class="mt-4 text-sm text-text-muted" data-testid="no-sectors">
            Todavía no hay sectores. Los stands pueden quedar sin sector; agregá uno arriba para
            agruparlos (por ejemplo, Comida o Ropa).
          </p>
        } @else {
          <ul class="mt-4 divide-y divide-border" aria-label="Sectores del evento">
            @for (s of rows; track s.id) {
              <li class="flex flex-wrap items-center gap-3 py-2" data-testid="sector-row">
                @if (editingId() === s.id) {
                  <input
                    #editField
                    class="field min-w-40 flex-1"
                    type="text"
                    autocomplete="off"
                    aria-label="Nuevo nombre del sector"
                    [attr.aria-invalid]="editErrors().name ? 'true' : null"
                    [value]="editName()"
                    (input)="editName.set(valueOf($event))"
                  />
                  <input
                    class="field w-24"
                    type="text"
                    inputmode="numeric"
                    autocomplete="off"
                    aria-label="Nuevo orden del sector"
                    [attr.aria-invalid]="editErrors().order ? 'true' : null"
                    [value]="editOrder()"
                    (input)="editOrder.set(valueOf($event))"
                  />
                  <button
                    type="button"
                    class="btn btn-primary"
                    [disabled]="busy()"
                    (click)="saveEdit(s)"
                  >
                    Guardar
                  </button>
                  <button type="button" class="btn" (click)="editingId.set(null)">Cancelar</button>
                  @if (editErrors().name || editErrors().order; as message) {
                    <span class="basis-full text-sm text-danger">{{ message }}</span>
                  }
                } @else {
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium">{{ s.name }}</span>
                    <span class="block text-xs text-text-muted">Orden {{ s.sortOrder }}</span>
                  </span>
                  <button
                    type="button"
                    class="btn"
                    [attr.aria-label]="'Editar sector ' + s.name"
                    (click)="startEdit(s)"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    class="btn btn-danger"
                    [attr.aria-label]="'Eliminar sector ' + s.name"
                    (click)="askRemove(s)"
                  >
                    Eliminar
                  </button>
                }
              </li>
            }
          </ul>
        }
      } @else {
        <p class="mt-4 text-sm text-text-muted" aria-live="polite">Cargando sectores…</p>
      }

      @if (removing(); as target) {
        <app-confirm-dialog
          [heading]="'¿Eliminar el sector ' + target.name + '?'"
          message="Sus stands no se borran: quedan sin sector."
          confirmLabel="Sí, eliminar"
          [busy]="busy()"
          (confirmed)="remove(target)"
          (cancelled)="removing.set(null)"
        />
      }
    </section>
  `,
})
export class SectorsPanel {
  readonly eventId = input.required<string>();

  private readonly repository = inject(EventInventoryRepository);
  private readonly injector = inject(Injector);
  private readonly form = viewChild<ElementRef<HTMLFormElement>>('form');
  private readonly editField = viewChild<ElementRef<HTMLInputElement>>('editField');
  protected readonly valueOf = valueOf;

  protected readonly list = signal<readonly SectorDto[] | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly removing = signal<SectorDto | null>(null);

  protected readonly name = signal('');
  protected readonly order = signal('');
  protected readonly errors = signal<Errors>({});

  protected readonly editingId = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly editOrder = signal('');
  protected readonly editErrors = signal<Errors>({});

  constructor() {
    afterNextRender(() => this.load(), { injector: this.injector });
  }

  protected create(event: Event): void {
    event.preventDefault();
    const parsed = this.parse(this.name(), this.order(), this.errors, this.form()?.nativeElement);
    if (!parsed) return;
    this.run(this.repository.createSector(this.eventId(), parsed), () => {
      this.name.set('');
      this.order.set('');
    });
  }

  protected startEdit(sector: SectorDto): void {
    this.editingId.set(sector.id);
    this.editName.set(sector.name);
    this.editOrder.set(String(sector.sortOrder));
    this.editErrors.set({});
    this.formError.set(null);
    afterNextRender(() => this.editField()?.nativeElement.focus(), { injector: this.injector });
  }

  protected saveEdit(sector: SectorDto): void {
    const row = this.editField()?.nativeElement.closest('li') ?? undefined;
    const parsed = this.parse(this.editName(), this.editOrder(), this.editErrors, row);
    if (!parsed) return;
    this.run(this.repository.updateSector(this.eventId(), sector.id, parsed), () =>
      this.editingId.set(null),
    );
  }

  protected askRemove(sector: SectorDto): void {
    this.removing.set(sector);
  }

  protected remove(sector: SectorDto): void {
    this.busy.set(true);
    this.repository.removeSector(this.eventId(), sector.id).subscribe({
      next: () => this.afterRemove(null),
      error: () => this.afterRemove(REMOVE_FAILED),
    });
  }

  private afterRemove(problem: string | null): void {
    this.busy.set(false);
    this.removing.set(null);
    this.formError.set(problem);
    this.load();
  }

  private run(request: Observable<SectorDto>, done: () => void): void {
    this.busy.set(true);
    this.formError.set(null);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        done();
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.formError.set(messageFor(error, {}, { 409: DUPLICATE }, SAVE_FAILED));
      },
    });
  }

  private parse(
    nameText: string,
    orderText: string,
    target: WritableSignal<Errors>,
    host: HTMLElement | undefined,
  ): Parsed | null {
    const name = nameText.trim();
    const text = orderText.trim();
    const errors: Errors = {};
    if (!name) errors.name = 'Ingresá el nombre del sector.';
    else if (name.length > 80) errors.name = 'Usá como máximo 80 caracteres.';
    if (text !== '' && (!/^\d+$/.test(text) || Number(text) > MAX_ORDER))
      errors.order = `Usá un número entre 0 y ${MAX_ORDER} en el orden.`;
    target.set(errors);
    if (Object.keys(errors).length > 0) {
      if (host) focusFirstInvalid(this.injector, host);
      return null;
    }
    return text === '' ? { name } : { name, sortOrder: Number(text) };
  }

  private load(): void {
    this.repository.listSectors(this.eventId()).subscribe({
      next: (rows) => {
        this.loadError.set(null);
        this.list.set(rows);
      },
      error: () => this.loadError.set(LOAD_FAILED),
    });
  }
}

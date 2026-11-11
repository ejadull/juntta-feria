import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { Observable } from 'rxjs';
import { messageFor } from '../../../shared/auth/problem';
import { valueOf } from '../../../shared/forms';
import { CategoryRepository, type CategoryDto } from '../data/category.repository';

const LOAD_FAILED = 'No pudimos cargar los rubros. Probá de nuevo en unos minutos.';
const SAVE_FAILED = 'No pudimos guardar el rubro. Probá de nuevo en unos minutos.';
const REMOVE_FAILED = 'No pudimos eliminar el rubro. Probá de nuevo en unos minutos.';
const BY_CODE = {
  CATEGORY_EXISTS: 'Ya tenés un rubro con ese nombre.',
  CATEGORY_IN_USE: 'No se puede eliminar: hay expositores con este rubro.',
};
const MAX_NAME = 60;

/**
 * EXH-02 (organizer side): the rubros of the organization. Exhibitors pick one of these in their
 * profile; a rubro in use cannot be deleted, so renaming is how it changes.
 */
@Component({
  selector: 'app-categories-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card mt-6" aria-labelledby="categories-heading">
      <h2 id="categories-heading" class="text-lg font-semibold">Rubros</h2>
      <p class="mt-1 text-sm text-text-muted">
        Las categorías que los feriantes eligen en su perfil. Se muestran en el mapa público.
      </p>

      <form class="mt-4 flex flex-wrap items-end gap-2" novalidate (submit)="add($event)">
        <label class="grid min-w-56 flex-1 gap-1 text-sm">
          <span>Nuevo rubro</span>
          <input
            class="field"
            type="text"
            autocomplete="off"
            maxlength="60"
            [attr.aria-invalid]="addError() ? 'true' : null"
            [attr.aria-describedby]="addError() ? 'category-add-error' : null"
            [value]="newName()"
            (input)="newName.set(valueOf($event))"
          />
        </label>
        <button type="submit" class="btn btn-primary" [disabled]="busy()">Agregar</button>
      </form>
      @if (addError(); as message) {
        <p id="category-add-error" role="alert" class="mt-2 text-sm text-danger">{{ message }}</p>
      }

      @if (notice(); as message) {
        <p role="status" class="mt-3 rounded-lg bg-available/15 p-3 text-sm text-text">
          {{ message }}
        </p>
      }
      @if (actionError(); as message) {
        <p role="alert" class="mt-3 rounded-lg bg-danger/10 p-3 text-sm text-text">{{ message }}</p>
      }

      @if (loadError(); as message) {
        <p role="alert" class="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-text">{{ message }}</p>
      } @else if (list(); as rows) {
        @if (rows.length === 0) {
          <p class="mt-4 text-sm text-text-muted" data-testid="no-categories">
            Todavía no hay rubros. Creá el primero para que los feriantes puedan elegirlo.
          </p>
        } @else {
          <ul class="mt-4 divide-y divide-border" aria-label="Rubros de la organización">
            @for (c of rows; track c.id) {
              <li class="flex flex-wrap items-center gap-2 py-2" data-testid="category-row">
                @if (editingId() === c.id) {
                  <form
                    class="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                    novalidate
                    (submit)="saveRename($event, c)"
                  >
                    <input
                      #renameInput
                      class="field min-w-48 flex-1"
                      type="text"
                      maxlength="60"
                      [attr.aria-label]="'Nuevo nombre de ' + c.name"
                      [value]="editName()"
                      (input)="editName.set(valueOf($event))"
                    />
                    <button type="submit" class="btn btn-primary" [disabled]="busy()">
                      Guardar
                    </button>
                    <button type="button" class="btn" (click)="editingId.set(null)">
                      Cancelar
                    </button>
                  </form>
                } @else {
                  <span class="min-w-0 flex-1">
                    <span class="font-medium">{{ c.name }}</span>
                    <span class="ml-2 text-xs text-text-muted"
                      >{{ c.exhibitorCount }}
                      {{ c.exhibitorCount === 1 ? 'expositor' : 'expositores' }}</span
                    >
                  </span>
                  <button
                    type="button"
                    class="btn"
                    [attr.aria-label]="'Renombrar ' + c.name"
                    (click)="startRename(c)"
                  >
                    Renombrar
                  </button>
                  <button
                    type="button"
                    class="btn btn-danger"
                    [attr.aria-label]="'Eliminar ' + c.name"
                    (click)="askRemove(c)"
                  >
                    Eliminar
                  </button>
                }
              </li>
            }
          </ul>
        }
      } @else {
        <p class="mt-4 text-sm text-text-muted" aria-live="polite">Cargando rubros…</p>
      }

      @if (removing(); as target) {
        <div
          role="alertdialog"
          aria-labelledby="category-remove-title"
          aria-describedby="category-remove-text"
          class="card mt-4 border-border-strong"
        >
          <p id="category-remove-title" class="font-semibold">
            ¿Eliminar el rubro {{ target.name }}?
          </p>
          <p id="category-remove-text" class="mt-1 text-sm text-text-muted">
            No se puede deshacer. Si hay expositores con este rubro, no se elimina.
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
    </section>
  `,
})
export class CategoriesPanel {
  private readonly repository = inject(CategoryRepository);
  private readonly injector = inject(Injector);
  private readonly cancel = viewChild<ElementRef<HTMLButtonElement>>('cancel');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  /** The list of rubros changed: the page refreshes what depends on it (its filter). */
  readonly changed = output<void>();

  protected readonly valueOf = valueOf;
  protected readonly list = signal<readonly CategoryDto[] | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly notice = signal('');
  protected readonly actionError = signal<string | null>(null);
  protected readonly addError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly newName = signal('');
  protected readonly editingId = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly removing = signal<CategoryDto | null>(null);

  constructor() {
    this.load();
  }

  protected add(event: Event): void {
    event.preventDefault();
    const name = this.newName().trim();
    const problem = this.problemWith(name);
    this.addError.set(problem);
    if (problem) return;
    this.run(this.repository.create(name), `Agregamos el rubro ${name}.`, SAVE_FAILED, () =>
      this.newName.set(''),
    );
  }

  protected startRename(category: CategoryDto): void {
    this.editName.set(category.name);
    this.editingId.set(category.id);
    afterNextRender(() => this.renameInput()?.nativeElement.focus(), { injector: this.injector });
  }

  protected saveRename(event: Event, category: CategoryDto): void {
    event.preventDefault();
    const name = this.editName().trim();
    const problem = this.problemWith(name);
    if (problem) {
      this.actionError.set(problem);
      return;
    }
    this.run(
      this.repository.rename(category.id, name),
      `Renombramos el rubro a ${name}.`,
      SAVE_FAILED,
      () => this.editingId.set(null),
    );
  }

  protected askRemove(category: CategoryDto): void {
    this.removing.set(category);
    afterNextRender(() => this.cancel()?.nativeElement.focus(), { injector: this.injector });
  }

  protected remove(category: CategoryDto): void {
    this.run(
      this.repository.remove(category.id),
      `Eliminamos el rubro ${category.name}.`,
      REMOVE_FAILED,
      () => undefined,
    );
    this.removing.set(null);
  }

  private problemWith(name: string): string | null {
    if (!name) return 'Ingresá el nombre del rubro.';
    if (name.length > MAX_NAME) return `Usá como máximo ${MAX_NAME} caracteres.`;
    return null;
  }

  private run(
    action: Observable<unknown>,
    success: string,
    failure: string,
    done: () => void,
  ): void {
    this.busy.set(true);
    this.actionError.set(null);
    this.notice.set('');
    action.subscribe({
      next: () => {
        this.busy.set(false);
        done();
        this.notice.set(success);
        this.load();
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.actionError.set(messageFor(error, BY_CODE, {}, failure));
      },
    });
  }

  private load(): void {
    this.repository.list().subscribe({
      next: (rows) => {
        this.loadError.set(null);
        this.list.set(rows);
      },
      error: () => this.loadError.set(LOAD_FAILED),
    });
  }
}

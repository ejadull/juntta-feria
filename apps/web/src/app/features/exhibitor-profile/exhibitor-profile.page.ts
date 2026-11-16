import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { messageFor } from '../../shared/auth/problem';
import { focusFirstInvalid, valueOf } from '../../shared/forms';
import { CategoryRepository, type CategoryDto } from '../exhibitors/data/category.repository';
import {
  ExhibitorProfileRepository,
  type ExhibitorProfileDto,
  type ExhibitorProfileInput,
} from './data/exhibitor-profile.repository';
import { ExhibitorPhotosSection } from './ui/exhibitor-photos-section';

const LOAD_FAILED = 'No pudimos cargar tu perfil. Probá de nuevo en unos minutos.';
const SAVE_FAILED = 'No pudimos guardar tu perfil. Probá de nuevo en unos minutos.';
const INVALID = 'Revisá los datos: el CUIT o el rubro no son válidos.';

type Field = 'tradeName' | 'legalName' | 'categoryId';
type Errors = Partial<Record<Field, string>>;

/**
 * EXH-01/EXH-02 (exhibitor): the exhibitor's own profile. The rubro is one of the organization's
 * categories; consent to appear in the public directory is the exhibitor's own choice (AC-11).
 */
@Component({
  selector: 'app-exhibitor-profile-page',
  imports: [ExhibitorPhotosSection],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <header>
        <p class="text-sm font-semibold tracking-wider text-primary-strong">FERIANTE</p>
        <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Mi perfil</h1>
        <p class="mt-2 text-text-muted">
          Los datos de tu emprendimiento. Hace falta completarlos para reservar un stand.
        </p>
      </header>

      @if (loadError(); as message) {
        <p role="alert" class="mt-6 rounded-xl bg-danger/10 p-4 text-text">{{ message }}</p>
      } @else if (!loaded()) {
        <p class="mt-6 text-text-muted" aria-live="polite">Cargando tu perfil…</p>
      } @else {
        <form
          #form
          class="card mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
          novalidate
          aria-label="Perfil del expositor"
          (submit)="save($event)"
        >
          <label class="grid gap-1 text-sm">
            <span>Nombre comercial</span>
            <input
              class="field"
              type="text"
              autocomplete="organization"
              [attr.aria-invalid]="errors().tradeName ? 'true' : null"
              [attr.aria-describedby]="errors().tradeName ? 'profile-trade-error' : null"
              [value]="tradeName()"
              (input)="tradeName.set(valueOf($event))"
            />
            @if (errors().tradeName; as message) {
              <span id="profile-trade-error" class="text-danger">{{ message }}</span>
            }
          </label>

          <label class="grid gap-1 text-sm">
            <span>Razón social</span>
            <input
              class="field"
              type="text"
              autocomplete="off"
              [attr.aria-invalid]="errors().legalName ? 'true' : null"
              [attr.aria-describedby]="errors().legalName ? 'profile-legal-error' : null"
              [value]="legalName()"
              (input)="legalName.set(valueOf($event))"
            />
            @if (errors().legalName; as message) {
              <span id="profile-legal-error" class="text-danger">{{ message }}</span>
            }
          </label>

          <label class="grid gap-1 text-sm">
            <span>CUIT (opcional)</span>
            <input
              class="field"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              [value]="taxId()"
              (input)="taxId.set(valueOf($event))"
            />
          </label>

          <label class="grid gap-1 text-sm">
            <span>Rubro</span>
            <select
              class="field"
              [attr.aria-invalid]="errors().categoryId ? 'true' : null"
              [attr.aria-describedby]="errors().categoryId ? 'profile-category-error' : null"
              (change)="categoryId.set(valueOf($event))"
            >
              <option value="" [selected]="categoryId() === ''">Elegí un rubro</option>
              @for (c of categories(); track c.id) {
                <option [value]="c.id" [selected]="c.id === categoryId()">{{ c.name }}</option>
              }
            </select>
            @if (errors().categoryId; as message) {
              <span id="profile-category-error" class="text-danger">{{ message }}</span>
            }
            @if (categories().length === 0) {
              <span class="text-xs text-text-muted" data-testid="no-categories-hint">
                La organización todavía no cargó rubros. Pedile que los cree para poder elegir uno.
              </span>
            }
          </label>

          <label class="grid gap-1 text-sm sm:col-span-2">
            <span>Descripción (opcional)</span>
            <textarea
              class="field"
              rows="3"
              maxlength="2000"
              [value]="description()"
              (input)="description.set(valueOf($event))"
            ></textarea>
          </label>

          <label class="flex items-start gap-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              class="mt-1"
              [checked]="publicContactOptIn()"
              (change)="publicContactOptIn.set(checked($event))"
            />
            <span>
              Acepto aparecer en el directorio público de las ferias de esta organización. Podés
              retirarlo cuando quieras.
            </span>
          </label>

          @if (formError(); as message) {
            <p role="alert" class="rounded-lg bg-danger/10 p-3 text-sm text-text sm:col-span-2">
              {{ message }}
            </p>
          }
          @if (notice(); as message) {
            <p role="status" class="rounded-lg bg-available/15 p-3 text-sm text-text sm:col-span-2">
              {{ message }}
            </p>
          }

          <div class="sm:col-span-2">
            <button type="submit" class="btn btn-primary" [disabled]="busy()">
              Guardar perfil
            </button>
          </div>
        </form>
        <app-exhibitor-photos-section [isPublic]="publicContactOptIn()" />
      }
    </div>
  `,
})
export class ExhibitorProfilePage {
  private readonly profiles = inject(ExhibitorProfileRepository);
  private readonly categoryRepo = inject(CategoryRepository);
  private readonly injector = inject(Injector);
  private readonly form = viewChild<ElementRef<HTMLFormElement>>('form');

  protected readonly valueOf = valueOf;
  protected readonly loaded = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly categories = signal<readonly CategoryDto[]>([]);

  protected readonly tradeName = signal('');
  protected readonly legalName = signal('');
  protected readonly taxId = signal('');
  protected readonly categoryId = signal('');
  protected readonly description = signal('');
  protected readonly publicContactOptIn = signal(false);

  protected readonly errors = signal<Errors>({});
  protected readonly formError = signal<string | null>(null);
  protected readonly notice = signal('');
  protected readonly busy = signal(false);

  constructor() {
    this.categoryRepo.list().subscribe({
      next: (list) => this.categories.set(list),
      error: () => this.loadError.set(LOAD_FAILED),
    });
    this.profiles.get().subscribe({
      next: (profile) => {
        if (profile) this.fill(profile);
        this.loaded.set(true);
      },
      error: () => this.loadError.set(LOAD_FAILED),
    });
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected save(event: Event): void {
    event.preventDefault();
    const input = this.validate();
    if (!input) return;
    this.busy.set(true);
    this.formError.set(null);
    this.notice.set('');
    this.profiles.save(input).subscribe({
      next: (profile) => {
        this.busy.set(false);
        this.fill(profile);
        this.notice.set('Guardamos tu perfil.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.formError.set(messageFor(error, {}, { 400: INVALID }, SAVE_FAILED));
      },
    });
  }

  private fill(profile: ExhibitorProfileDto): void {
    this.tradeName.set(profile.tradeName);
    this.legalName.set(profile.legalName);
    this.taxId.set(profile.taxId ?? '');
    this.categoryId.set(profile.categoryId ?? '');
    this.description.set(profile.description);
    this.publicContactOptIn.set(profile.publicContactOptIn);
  }

  private validate(): ExhibitorProfileInput | null {
    const errors: Errors = {};
    const tradeName = this.tradeName().trim();
    const legalName = this.legalName().trim();
    if (!tradeName) errors.tradeName = 'Ingresá el nombre comercial.';
    if (!legalName) errors.legalName = 'Ingresá la razón social.';
    if (!this.categoryId()) errors.categoryId = 'Elegí un rubro.';
    this.errors.set(errors);
    if (Object.keys(errors).length > 0) {
      const host = this.form()?.nativeElement;
      if (host) focusFirstInvalid(this.injector, host);
      return null;
    }
    return {
      tradeName,
      legalName,
      taxId: this.taxId().trim() || null,
      categoryId: this.categoryId(),
      description: this.description().trim(),
      publicContactOptIn: this.publicContactOptIn(),
    };
  }
}

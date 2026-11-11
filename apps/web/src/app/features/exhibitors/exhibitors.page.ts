import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { fold } from '../../shared/text';
import {
  ExhibitorRepository,
  type DocumentsStatus,
  type ExhibitorSummaryDto,
} from './data/exhibitor.repository';
import { CategoryRepository, type CategoryDto } from './data/category.repository';
import { CategoriesPanel } from './ui/categories-panel';
import { DOCUMENTS_STATUS, ExhibitorDetail } from './ui/exhibitor-detail';
import { InvitationsPanel } from './ui/invitations-panel';

type State = { readonly list: readonly ExhibitorSummaryDto[] } | { readonly error: string };

/** P11 (design D4): organizer view of exhibitors, their rubros (EXH-02) and documents (EXH-03). */
@Component({
  selector: 'app-exhibitors-page',
  imports: [CategoriesPanel, ExhibitorDetail, InvitationsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-sm font-semibold tracking-wider text-primary-strong">ORGANIZADOR</p>
          <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Expositores</h1>
        </div>
      </header>

      @if (error(); as message) {
        <p role="alert" class="mt-6 rounded-xl bg-danger/10 p-4 text-text">{{ message }}</p>
      } @else if (loaded() && list().length === 0) {
        <div class="card mt-6" data-testid="no-exhibitors">
          <p class="font-semibold">Todavía no hay expositores</p>
          <p class="mt-1 text-sm text-text-muted">
            Cuando un feriante acepte tu invitación o cree su perfil en tu organización, aparece acá
            con su rubro y el estado de su documentación.
          </p>
        </div>
      } @else {
        <div class="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section class="card" aria-label="Listado de expositores">
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
              <input
                type="search"
                class="field"
                placeholder="Buscar por nombre, razón social o rubro…"
                aria-label="Buscar expositor"
                [value]="query()"
                (input)="query.set(valueOf($event))"
              />
              <select class="field" aria-label="Rubro" (change)="category.set(valueOf($event))">
                <option value="">Todos los rubros</option>
                @for (c of categories(); track c.id) {
                  <option [value]="c.id">{{ c.name }}</option>
                }
              </select>
              <select
                class="field"
                aria-label="Documentación"
                (change)="docs.set($any(valueOf($event)))"
              >
                <option value="">Toda la documentación</option>
                @for (s of statuses; track s) {
                  <option [value]="s">{{ statusInfo[s].label }}</option>
                }
              </select>
            </div>
            <p class="mt-3 text-xs text-text-muted" aria-live="polite">
              {{ filtered().length }} de {{ list().length }} expositores
            </p>

            <ul class="mt-2 divide-y divide-border">
              @for (e of filtered(); track e.id) {
                <li>
                  <button
                    type="button"
                    class="row"
                    [attr.data-id]="e.id"
                    [attr.aria-current]="e.id === selectedId() ? 'true' : null"
                    (click)="selectedId.set(e.id)"
                  >
                    <span class="min-w-0">
                      <span class="name block truncate font-medium">{{ e.tradeName }}</span>
                      <span class="block truncate text-xs text-text-muted"
                        >{{ e.category ?? 'Sin rubro' }} · {{ e.legalName }}</span
                      >
                    </span>
                    <span
                      class="status ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs"
                      [class]="statusInfo[e.documentsStatus].tone"
                    >
                      <span aria-hidden="true">{{ statusInfo[e.documentsStatus].icon }}</span>
                      {{ statusInfo[e.documentsStatus].label }}
                    </span>
                  </button>
                </li>
              } @empty {
                <li class="py-6 text-center text-sm text-text-muted">
                  Ningún expositor coincide con la búsqueda.
                </li>
              }
            </ul>
          </section>

          <aside class="card self-start" aria-label="Ficha del expositor">
            <app-exhibitor-detail [exhibitor]="selected()" (reviewed)="reload()" />
          </aside>
        </div>
      }

      <app-categories-panel (changed)="reloadAll()" />
      <app-invitations-panel />
    </div>
  `,
  styles: `
    .row {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 0.5rem;
      border-radius: 0.5rem;
      text-align: left;
    }
    .row:hover {
      background: var(--color-surface-soft);
    }
    .row[aria-current='true'] {
      background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
      box-shadow: inset 3px 0 0 var(--color-primary);
    }
    /* Text on a tint uses --color-text (UX-01 rule); the status badge keeps its own colors. */
    .row[aria-current='true'] > span:first-child span {
      color: var(--color-text);
    }
    .row:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: -2px;
    }
  `,
})
export class ExhibitorsPage {
  private readonly repo = inject(ExhibitorRepository);
  private readonly categoryRepo = inject(CategoryRepository);

  private readonly state = signal<State | null>(null);
  protected readonly categories = signal<readonly CategoryDto[]>([]);

  protected readonly query = signal('');
  protected readonly category = signal('');
  protected readonly docs = signal<DocumentsStatus | ''>('');
  protected readonly selectedId = signal<string | null>(null);

  protected readonly statuses = Object.keys(DOCUMENTS_STATUS) as DocumentsStatus[];
  protected readonly statusInfo = DOCUMENTS_STATUS;

  protected readonly error = computed(() => {
    const s = this.state();
    return s && 'error' in s ? s.error : null;
  });
  protected readonly loaded = computed(() => this.state() !== null);
  protected readonly list = computed(() => {
    const s = this.state();
    return s && 'list' in s ? s.list : [];
  });
  protected readonly filtered = computed(() => {
    const q = fold(this.query().trim());
    const category = this.category();
    const docs = this.docs();
    return this.list().filter(
      (e) =>
        (!category || e.categoryId === category) &&
        (!docs || e.documentsStatus === docs) &&
        (!q || fold(`${e.tradeName} ${e.legalName} ${e.category ?? ''}`).includes(q)),
    );
  });
  protected readonly selected = computed(
    () => this.list().find((e) => e.id === this.selectedId()) ?? null,
  );

  constructor() {
    this.reload();
    this.loadCategories();
  }

  /** Refreshes the list, e.g. after a document review changed an exhibitor's status. */
  protected reload(): void {
    this.repo.list().subscribe({
      next: (list) => this.state.set({ list }),
      error: () =>
        this.state.set({
          error: 'No se pudieron cargar los expositores. Probá de nuevo en unos minutos.',
        }),
    });
  }

  /** Rubros were added, renamed or removed: the filter and the exhibitors' rubro names change. */
  protected reloadAll(): void {
    this.reload();
    this.loadCategories();
  }

  private loadCategories(): void {
    // The filter only narrows the list: without rubros it simply offers none.
    this.categoryRepo.list().subscribe({
      next: (list) => {
        this.categories.set(list);
        if (!list.some((c) => c.id === this.category())) this.category.set('');
      },
      error: () => this.categories.set([]),
    });
  }

  protected valueOf(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
}

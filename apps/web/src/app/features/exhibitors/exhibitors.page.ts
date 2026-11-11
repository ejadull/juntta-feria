import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';
import { fold } from '../../shared/text';
import {
  ExhibitorRepository,
  type DocumentsStatus,
  type ExhibitorSummaryDto,
} from './data/exhibitor.repository';
import { DOCUMENTS_STATUS, ExhibitorDetail } from './ui/exhibitor-detail';

type State = { readonly list: readonly ExhibitorSummaryDto[] } | { readonly error: string };

/** P11 (design D4): read-only organizer view of exhibitors. Verification actions arrive with EXH-01. */
@Component({
  selector: 'app-exhibitors-page',
  imports: [ExhibitorDetail],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-sm font-semibold tracking-wider text-primary-strong">ORGANIZADOR</p>
          <h1 class="mt-1 text-3xl font-semibold sm:text-4xl">Expositores</h1>
        </div>
        <span class="rounded-full bg-reserved/15 px-3 py-1 text-xs font-medium text-text">
          Datos de demostración
        </span>
      </header>

      @if (error(); as message) {
        <p role="alert" class="mt-6 rounded-xl bg-danger/10 p-4 text-text">{{ message }}</p>
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
                @for (c of categories(); track c) {
                  <option [value]="c">{{ c }}</option>
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
                        >{{ e.category }} · {{ e.legalName }}</span
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
            <app-exhibitor-detail [exhibitor]="selected()" />
          </aside>
        </div>
      }
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

  private readonly state = toSignal<State | null>(
    this.repo.list().pipe(
      map((list): State => ({ list })),
      catchError(() =>
        of<State>({
          error: 'No se pudieron cargar los expositores. Probá de nuevo en unos minutos.',
        }),
      ),
    ),
    { initialValue: null },
  );

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
  protected readonly list = computed(() => {
    const s = this.state();
    return s && 'list' in s ? s.list : [];
  });
  protected readonly categories = computed(() =>
    [...new Set(this.list().map((e) => e.category))].sort((a, b) => a.localeCompare(b, 'es')),
  );
  protected readonly filtered = computed(() => {
    const q = fold(this.query().trim());
    const category = this.category();
    const docs = this.docs();
    return this.list().filter(
      (e) =>
        (!category || e.category === category) &&
        (!docs || e.documentsStatus === docs) &&
        (!q || fold(`${e.tradeName} ${e.legalName} ${e.category}`).includes(q)),
    );
  });
  protected readonly selected = computed(
    () => this.list().find((e) => e.id === this.selectedId()) ?? null,
  );

  protected valueOf(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
}

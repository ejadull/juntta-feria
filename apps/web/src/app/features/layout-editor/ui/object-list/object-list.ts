import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { fromPolygon, round2 } from '../../domain/geometry';
import type { LayoutObjectDto, LayoutObjectKind } from '../../domain/layout.types';
import { KIND_LABEL } from '../../domain/validation';

type KindFilter = LayoutObjectKind | 'ALL';

interface Item {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly invalid: boolean;
}

const KINDS = Object.keys(KIND_LABEL) as LayoutObjectKind[];

function toItem(o: LayoutObjectDto, invalid: boolean): Item {
  const rect = fromPolygon(o.geometry);
  const title = o.code?.trim() || (o.kind === 'STAND' ? 'Sin código' : KIND_LABEL[o.kind]);
  const size = rect ? `${round2(rect.w * rect.h)} m²` : 'forma libre';
  return { id: o.id, title, detail: `${KIND_LABEL[o.kind]} · ${size}`, invalid };
}

/** Accessible alternative to the canvas (AC-12): filterable list synced with the selection. */
@Component({
  selector: 'app-object-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="mb-3 text-sm font-semibold text-text">Objetos</h2>
    <div class="mb-2 flex flex-col gap-2">
      <input
        type="search"
        class="field"
        placeholder="Buscar código…"
        aria-label="Buscar objeto por código o tipo"
        [value]="query()"
        (input)="query.set(valueOf($event))"
      />
      <select
        class="field"
        aria-label="Filtrar por tipo"
        (change)="kind.set($any(valueOf($event)))"
      >
        <option value="ALL">Todos</option>
        @for (k of kinds; track k) {
          <option [value]="k">{{ kindLabel[k] }}</option>
        }
      </select>
    </div>
    <p class="mb-2 text-xs text-text-muted" aria-live="polite">
      {{ items().length }} de {{ objects().length }} objetos
    </p>
    <ul class="flex flex-col gap-0.5">
      @for (item of items(); track item.id) {
        <li>
          <button
            type="button"
            class="item"
            [attr.data-id]="item.id"
            [attr.aria-current]="item.id === selectedId() ? 'true' : null"
            [attr.aria-label]="
              item.title + ', ' + item.detail + (item.invalid ? ', con errores' : '')
            "
            (click)="select.emit(item.id)"
          >
            @if (item.invalid) {
              <span class="text-danger" aria-hidden="true">⚠</span>
            }
            <span class="font-medium">{{ item.title }}</span>
            <span class="ml-auto text-xs text-text-muted">{{ item.detail }}</span>
          </button>
        </li>
      } @empty {
        <li class="px-2 py-1 text-sm text-text-muted">Ningún objeto coincide.</li>
      }
    </ul>
  `,
  styles: `
    .item {
      display: flex;
      width: 100%;
      align-items: baseline;
      gap: 0.375rem;
      padding: 0.375rem 0.5rem;
      border-radius: 0.375rem;
      text-align: left;
      font-size: 0.875rem;
    }
    .item:hover {
      background: var(--color-surface-soft);
    }
    .item[aria-current='true'] {
      background: color-mix(in srgb, var(--color-selected) 12%, var(--color-surface));
      box-shadow: inset 3px 0 0 var(--color-selected);
    }
    /* Text on a tint uses --color-text: text-muted there drops to 4.3:1 (UX-01 rule). */
    .item[aria-current='true'] span {
      color: var(--color-text);
    }
    .item:focus-visible {
      outline: 2px solid var(--color-selected);
      outline-offset: -2px;
    }
  `,
})
export class ObjectList {
  readonly objects = input.required<readonly LayoutObjectDto[]>();
  readonly selectedId = input<string | null>(null);
  readonly invalidIds = input<ReadonlySet<string>>(new Set());

  readonly select = output<string>();

  protected readonly query = signal('');
  protected readonly kind = signal<KindFilter>('ALL');
  protected readonly kinds = KINDS;
  protected readonly kindLabel = KIND_LABEL;

  protected readonly items = computed(() => {
    const q = this.query().trim().toLowerCase();
    const kind = this.kind();
    const invalid = this.invalidIds();
    return this.objects()
      .filter((o) => kind === 'ALL' || o.kind === kind)
      .map((o) => toItem(o, invalid.has(o.id)))
      .filter((i) => !q || `${i.title} ${i.detail}`.toLowerCase().includes(q));
  });

  protected valueOf(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
}

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ObjectPatch } from '../../domain/commands';
import { fromPolygon } from '../../domain/geometry';
import type { LayoutObjectDto, LayoutObjectKind } from '../../domain/layout.types';
import { KIND_LABEL } from '../../domain/validation';

type GeometryKey = 'w' | 'h' | 'x' | 'y';

const KINDS = Object.keys(KIND_LABEL) as LayoutObjectKind[];
const GEOMETRY_FIELDS: readonly { readonly key: GeometryKey; readonly label: string }[] = [
  { key: 'w', label: 'Ancho (m)' },
  { key: 'h', label: 'Largo (m)' },
  { key: 'x', label: 'X (m)' },
  { key: 'y', label: 'Y (m)' },
];

const valueOf = (e: Event): string => (e.target as HTMLInputElement | HTMLSelectElement).value;

/**
 * Properties of the selected object: only layout data (code, kind, size, position).
 * Never commercial data (price, reservation, exhibitor) — those belong to the event (spec §3).
 */
@Component({
  selector: 'app-object-properties',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="mb-3 text-sm font-semibold text-text">Propiedades</h2>
    @if (object(); as o) {
      <div class="grid grid-cols-2 gap-3 text-sm">
        <label class="col-span-2 flex flex-col gap-1">
          <span class="text-text-muted">Código</span>
          <input
            name="code"
            type="text"
            class="field"
            [value]="o.code ?? ''"
            [disabled]="readOnly()"
            (change)="patch.emit({ code: valueOf($event) })"
          />
        </label>
        <label class="col-span-2 flex flex-col gap-1">
          <span class="text-text-muted">Tipo</span>
          <select name="kind" class="field" [disabled]="readOnly()" (change)="onKind($event)">
            @for (k of kinds; track k) {
              <option [value]="k" [selected]="k === o.kind">{{ kindLabel[k] }}</option>
            }
          </select>
        </label>
        @for (f of fields; track f.key) {
          <label class="flex flex-col gap-1">
            <span class="text-text-muted">{{ f.label }}</span>
            <input
              [name]="f.key"
              type="number"
              inputmode="decimal"
              class="field tabular-nums"
              [attr.step]="step()"
              [attr.min]="f.key === 'w' || f.key === 'h' ? step() : 0"
              [value]="rect()?.[f.key] ?? ''"
              [disabled]="readOnly() || !rect()"
              (change)="onGeometry(f.key, $event)"
            />
          </label>
        }
      </div>
      @if (!rect()) {
        <p class="mt-3 text-xs text-text-muted">
          Forma libre: la geometría se muestra pero no se edita acá.
        </p>
      }
      @if (!readOnly()) {
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" class="btn" [disabled]="!rect()" (click)="rotate.emit()">
            ⟳ Rotar 90°
          </button>
          <button type="button" class="btn" [disabled]="!rect()" (click)="duplicate.emit()">
            ⧉ Duplicar
          </button>
          <button type="button" class="btn btn-danger" (click)="remove.emit()">✕ Borrar</button>
        </div>
      }
    } @else {
      <p class="text-sm text-text-muted">Seleccioná un objeto en el plano o en la lista.</p>
    }
  `,
})
export class ObjectProperties {
  readonly object = input<LayoutObjectDto | null>(null);
  readonly step = input(0.5);
  readonly readOnly = input(false);

  readonly patch = output<ObjectPatch>();
  readonly rotate = output<void>();
  readonly duplicate = output<void>();
  readonly remove = output<void>();

  protected readonly kinds = KINDS;
  protected readonly kindLabel = KIND_LABEL;
  protected readonly fields = GEOMETRY_FIELDS;
  protected readonly valueOf = valueOf;
  protected readonly rect = computed(() => {
    const o = this.object();
    return o ? fromPolygon(o.geometry) : null;
  });

  protected onKind(e: Event): void {
    this.patch.emit({ kind: valueOf(e) as LayoutObjectKind });
  }

  protected onGeometry(key: GeometryKey, e: Event): void {
    const raw = valueOf(e).trim();
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value)) return;
    this.patch.emit({ [key]: value });
  }
}

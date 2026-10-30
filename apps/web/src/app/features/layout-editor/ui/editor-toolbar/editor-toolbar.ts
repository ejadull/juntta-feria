import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import type { LayoutObjectKind } from '../../domain/layout.types';
import { KIND_LABEL } from '../../domain/validation';
import type { SnapStep } from '../../state/layout-editor.store';

const KINDS = Object.keys(KIND_LABEL) as LayoutObjectKind[];
const STEPS: readonly SnapStep[] = [0.25, 0.5, 1];

/**
 * Draft-only actions. Zoom lives on the canvas controls; "Crear nueva versión" lives in the
 * read-only banner, where the editor offers it (AC-04).
 */
@Component({
  selector: 'app-editor-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="toolbar"
      aria-label="Herramientas del editor"
      class="flex flex-wrap items-center gap-2"
    >
      <div class="flex items-center gap-1">
        <select
          class="field w-40"
          aria-label="Tipo a agregar"
          (change)="kindToAdd.set($any(valueOf($event)))"
        >
          @for (k of kinds; track k) {
            <option [value]="k" [selected]="k === kindToAdd()">{{ kindLabel[k] }}</option>
          }
        </select>
        <button type="button" class="btn" (click)="add.emit(kindToAdd())">＋ Agregar</button>
      </div>

      <label class="flex items-center gap-1 text-sm text-text-muted">
        Snap
        <select
          class="field"
          aria-label="Paso de snap"
          (change)="stepChange.emit($any(+valueOf($event)))"
        >
          @for (s of steps; track s) {
            <option [value]="s" [selected]="s === step()">{{ s }} m</option>
          }
        </select>
      </label>

      <div class="flex items-center gap-1">
        <button
          type="button"
          class="btn"
          title="Deshacer (Ctrl+Z)"
          [disabled]="!canUndo()"
          (click)="undo.emit()"
        >
          ↶ Deshacer
        </button>
        <button
          type="button"
          class="btn"
          title="Rehacer (Ctrl+Shift+Z)"
          [disabled]="!canRedo()"
          (click)="redo.emit()"
        >
          ↷ Rehacer
        </button>
      </div>

      <div class="ml-auto flex items-center gap-2">
        @if (isDirty()) {
          <span class="text-xs text-text-muted">Cambios sin guardar</span>
        }
        <button type="button" class="btn" [disabled]="!isDirty() || busy()" (click)="save.emit()">
          Guardar
        </button>
        <button
          type="button"
          class="btn btn-primary"
          [disabled]="!canPublish() || busy()"
          [attr.title]="canPublish() ? null : 'Corregí los errores de validación para publicar'"
          (click)="publish.emit()"
        >
          Publicar
        </button>
      </div>
    </div>
  `,
})
export class EditorToolbar {
  readonly step = input<SnapStep>(0.5);
  readonly canUndo = input(false);
  readonly canRedo = input(false);
  readonly canPublish = input(false);
  readonly isDirty = input(false);
  readonly busy = input(false);

  readonly add = output<LayoutObjectKind>();
  readonly stepChange = output<SnapStep>();
  readonly undo = output<void>();
  readonly redo = output<void>();
  readonly save = output<void>();
  readonly publish = output<void>();

  protected readonly kindToAdd = signal<LayoutObjectKind>('STAND');
  protected readonly kinds = KINDS;
  protected readonly kindLabel = KIND_LABEL;
  protected readonly steps = STEPS;

  protected valueOf(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  PendingTasks,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { LayoutNotFoundError } from './data/layout.repository';
import type { LayoutObjectKind, LayoutVersionStatus } from './domain/layout.types';
import { KIND_LABEL } from './domain/validation';
import { runEditorAction, type EditorAction } from './state/editor-actions';
import { LayoutEditorStore } from './state/layout-editor.store';
import { EditorToolbar } from './ui/editor-toolbar/editor-toolbar';
import { FloorPlanCanvas } from './ui/floor-plan-canvas/floor-plan-canvas';
import { ObjectList } from './ui/object-list/object-list';
import { ObjectProperties } from './ui/object-properties/object-properties';
import { ValidationPanel } from './ui/validation-panel/validation-panel';

const STATUS_LABEL: Readonly<Record<LayoutVersionStatus, string>> = {
  DRAFT: 'Borrador',
  PUBLISHED: 'Publicada',
  ARCHIVED: 'Archivada',
};

/** Container (P06): the only piece that knows the store; ui/ components get inputs and emit intents. */
@Component({
  selector: 'app-layout-editor-page',
  imports: [FloorPlanCanvas, ObjectList, ObjectProperties, ValidationPanel, EditorToolbar],
  providers: [LayoutEditorStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The shell's <main> scrolls; the page keeps its natural height (mockup "Stand Studio").
  host: { class: 'block text-text' },
  template: `
    <div class="mx-auto flex max-w-[100rem] flex-col gap-4 px-4 py-6 sm:px-8 sm:py-8">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm font-semibold tracking-wider text-primary">
            ORGANIZADOR · PLANO DEL PREDIO
          </p>
          <h1 class="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Editor de plano</h1>
          @if (store.version(); as v) {
            <p class="mt-2 text-text-muted">
              Predio de {{ v.widthM }} × {{ v.heightM }} m a escala. Arrastrá, rotá y duplicá
              objetos; validá y publicá una versión inmutable.
            </p>
          }
        </div>
        @if (store.version()) {
          <span
            role="status"
            class="inline-flex items-center gap-1.5 rounded-full border border-current px-3 py-1 text-sm font-medium"
            [class.text-danger]="issueCount() > 0"
            [class.text-primary]="issueCount() === 0"
          >
            {{ issueCount() === 0 ? '✓ Sin errores' : '⚠ ' + issueCount() + ' error(es)' }}
          </span>
        }
      </header>

      @if (loadError(); as error) {
        <p role="alert" class="card text-danger">{{ error }}</p>
      } @else if (store.version(); as v) {
        <section
          class="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-border bg-surface px-5 py-3"
          aria-label="Versión del plano"
        >
          <div class="flex min-w-0 flex-wrap items-center gap-3">
            @if (store.isReadOnly()) {
              <span
                class="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
              >
                v{{ v.version }} {{ statusLabel().toLowerCase() }}
              </span>
            } @else {
              <span class="rounded-full bg-reserved/20 px-2.5 py-1 text-xs font-semibold text-text">
                v{{ v.version }} borrador
              </span>
            }
            <span class="text-sm text-text-muted">
              Versión {{ v.version }} · {{ statusLabel() }} · {{ v.widthM }} × {{ v.heightM }} m
            </span>
          </div>
          @if (store.isReadOnly()) {
            <div
              role="status"
              class="banner ml-auto flex flex-wrap items-center gap-3 text-sm text-text"
            >
              <span>
                <span aria-hidden="true">🔒</span> Versión {{ statusLabel().toLowerCase() }}: solo
                lectura. Para cambiar el plano, creá una nueva versión en borrador.
              </span>
              <button
                type="button"
                class="btn btn-primary"
                [disabled]="busy()"
                (click)="newVersion()"
              >
                Crear nueva versión
              </button>
            </div>
          } @else {
            <app-editor-toolbar
              class="ml-auto"
              [step]="store.step()"
              [canUndo]="store.canUndo()"
              [canRedo]="store.canRedo()"
              [canPublish]="store.canPublish()"
              [isDirty]="store.isDirty()"
              [busy]="busy()"
              (add)="addObject($event)"
              (stepChange)="store.setStep($event)"
              (undo)="act({ type: 'undo' })"
              (redo)="act({ type: 'redo' })"
              (save)="save()"
              (publish)="publish()"
            />
          }
        </section>

        <!-- DOM order: canvas first (main content), then the side panels. -->
        <div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <app-floor-plan-canvas
            class="h-[70vh] min-h-[28rem] rounded-lg border border-border"
            [widthM]="v.widthM"
            [heightM]="v.heightM"
            [objects]="store.objects()"
            [selectedId]="store.selectedId()"
            [invalidIds]="invalidIds()"
            [readOnly]="store.isReadOnly()"
            [snapStep]="store.step()"
            (selectObject)="store.select($event)"
            (dragStart)="store.beginGesture()"
            (dragTo)="store.move($event.id, $event)"
            (resizeTo)="store.resize($event.id, $event.handle, $event)"
            (dragEnd)="store.commitGesture()"
            (dragCancel)="store.cancelGesture()"
            (keyAction)="act($event)"
          />
          <div class="flex flex-col gap-4">
            <section class="card">
              <app-object-properties
                [object]="store.selected()"
                [step]="store.step()"
                [readOnly]="store.isReadOnly()"
                (patch)="withSelected((id) => store.updateProps(id, $event))"
                (rotate)="act({ type: 'rotate' })"
                (duplicate)="act({ type: 'duplicate' })"
                (remove)="act({ type: 'remove' })"
              />
            </section>
            <section class="card">
              <app-validation-panel
                [issues]="store.validation()"
                [serverIssues]="store.serverIssues()"
                (select)="store.select($event)"
              />
            </section>
            <section class="card max-h-[30rem] overflow-y-auto">
              <app-object-list
                [objects]="store.objects()"
                [selectedId]="store.selectedId()"
                [invalidIds]="invalidIds()"
                (select)="store.select($event)"
              />
            </section>
          </div>
        </div>
        <p class="text-sm text-text-muted empty:hidden" aria-live="polite" data-announcer>
          {{ message() }}
        </p>
      } @else {
        <p class="text-text-muted">Cargando plano…</p>
      }
    </div>
  `,
})
export class LayoutEditorPage {
  /** Bound from the `:versionId` route param (withComponentInputBinding). */
  readonly versionId = input.required<string>();

  protected readonly store = inject(LayoutEditorStore);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly issueCount = computed(() => this.store.validation().length);
  protected readonly invalidIds = computed(
    () => new Set(this.store.validation().flatMap((i) => i.objectIds)),
  );
  protected readonly statusLabel = computed(() => {
    const status = this.store.version()?.status;
    return status ? STATUS_LABEL[status] : '';
  });

  private readonly canvas = viewChild(FloorPlanCanvas);
  private readonly router = inject(Router);
  private readonly pendingTasks = inject(PendingTasks);

  constructor() {
    effect(() => {
      const id = this.versionId();
      this.loadError.set(null);
      // PendingTasks keeps the app "unstable" until loading settles (SSR, tests, whenStable).
      void this.pendingTasks.run(async () => {
        try {
          await this.store.load(id);
        } catch (error: unknown) {
          this.loadError.set(
            error instanceof LayoutNotFoundError
              ? `No existe la versión de plano "${id}".`
              : 'No se pudo cargar el plano. Probá de nuevo en unos minutos.',
          );
        }
      });
    });
  }

  protected withSelected(action: (id: string) => void): void {
    const id = this.store.selectedId();
    if (id) action(id);
  }

  /** Keyboard shortcuts and edit buttons: run, announce, and move focus where the user expects it. */
  protected act(action: EditorAction): void {
    const issuesBefore = this.issueCount();
    const result = runEditorAction(this.store, action);
    if (!result) return;
    this.announce(result.message, issuesBefore);
    if (result.focus === 'plan') this.canvas()?.focusPlan();
    else if (result.focus) this.canvas()?.focusObject(result.focus.id);
  }

  /** New objects land in the middle of what the operator is looking at, and get focus. */
  protected addObject(kind: LayoutObjectKind): void {
    const v = this.store.version();
    const at = this.canvas()?.viewCenter() ?? (v ? { x: v.widthM / 2, y: v.heightM / 2 } : null);
    if (!at) return;
    const issuesBefore = this.issueCount();
    this.store.add(kind, at);
    const id = this.store.selectedId();
    if (!id) return;
    this.announce(`${KIND_LABEL[kind]} agregado.`, issuesBefore);
    this.canvas()?.focusObject(id);
  }

  /** aria-live text; mentions validation only when the number of errors changed. */
  private announce(text: string, issuesBefore: number): void {
    const n = this.issueCount();
    const validation =
      n === issuesBefore
        ? ''
        : n === 0
          ? ' Sin errores de validación.'
          : ` ${n} ${n === 1 ? 'error' : 'errores'} de validación.`;
    this.message.set(text + validation);
  }

  protected save(): void {
    this.run(async () => {
      await this.store.save();
      return 'Borrador guardado.';
    });
  }

  protected publish(): void {
    this.run(async () =>
      (await this.store.publish())
        ? 'Versión publicada. Ahora es de solo lectura.'
        : 'El servidor rechazó la publicación. Revisá los errores.',
    );
  }

  protected newVersion(): void {
    this.run(async () => {
      await this.store.createNewVersion();
      const draft = this.store.version();
      if (!draft) return 'No se pudo crear la nueva versión.';
      // Keep the URL in sync so a reload opens the new draft, not the published one.
      await this.router.navigate(['/organizador/layouts', draft.id, 'editor'], {
        replaceUrl: true,
      });
      return `Versión ${draft.version} creada como borrador.`;
    });
  }

  private run(task: () => Promise<string>): void {
    this.busy.set(true);
    void this.pendingTasks.run(async () => {
      try {
        this.message.set(await task());
      } catch {
        this.message.set('No se pudo completar la acción. Probá de nuevo en unos minutos.');
      } finally {
        this.busy.set(false);
      }
    });
  }
}

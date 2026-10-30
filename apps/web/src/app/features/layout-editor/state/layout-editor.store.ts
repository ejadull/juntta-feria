import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LayoutRepository, PublishRejectedError } from '../data/layout.repository';
import {
  addObject,
  duplicateObject,
  moveObject,
  removeObject,
  resizeObject,
  rotate90,
  updateProps,
  type EditContext,
  type ObjectPatch,
  type Point,
  type ResizeHandle,
} from '../domain/commands';
import type { LayoutObjectDto, LayoutObjectKind, LayoutVersionDto } from '../domain/layout.types';
import { validateLayout, type ValidationIssue } from '../domain/validation';

export const ID_GENERATOR = new InjectionToken<() => string>('ID_GENERATOR', {
  providedIn: 'root',
  factory: () => () => crypto.randomUUID(),
});

export const HISTORY_LIMIT = 100;
export type SnapStep = 0.25 | 0.5 | 1;

type Objects = readonly LayoutObjectDto[];

/**
 * Editor state for one layout version. Provide it at the editor page level (one instance per editor).
 * History stores object snapshots; commands are the pure functions in domain/commands.
 */
@Injectable()
export class LayoutEditorStore {
  private readonly repo = inject(LayoutRepository);
  private readonly newId = inject(ID_GENERATOR);

  private readonly _version = signal<LayoutVersionDto | null>(null);
  private readonly _past = signal<readonly Objects[]>([]);
  private readonly _future = signal<readonly Objects[]>([]);
  private readonly _selectedId = signal<string | null>(null);
  private readonly _step = signal<SnapStep>(0.5);
  private readonly _dirty = signal(false);
  private readonly _serverIssues = signal<readonly ValidationIssue[]>([]);
  /** Snapshot taken at beginGesture; while set, commands update live without pushing history. */
  private gestureBase: Objects | null = null;

  readonly version = this._version.asReadonly();
  readonly step = this._step.asReadonly();
  readonly isDirty = this._dirty.asReadonly();
  readonly serverIssues = this._serverIssues.asReadonly();
  readonly selectedId = this._selectedId.asReadonly();

  readonly objects = computed<Objects>(() => this._version()?.objects ?? []);
  readonly selected = computed(
    () => this.objects().find((o) => o.id === this._selectedId()) ?? null,
  );
  readonly isReadOnly = computed(() => this._version()?.status !== 'DRAFT');
  readonly validation = computed(() => {
    const version = this._version();
    return version ? validateLayout(version) : [];
  });
  readonly canPublish = computed(() => !this.isReadOnly() && this.validation().length === 0);
  readonly canUndo = computed(() => !this.isReadOnly() && this._past().length > 0);
  readonly canRedo = computed(() => !this.isReadOnly() && this._future().length > 0);

  private readonly ctx = computed<EditContext>(() => {
    const v = this._version();
    return { bounds: { widthM: v?.widthM ?? 0, heightM: v?.heightM ?? 0 }, step: this._step() };
  });

  async load(versionId: string): Promise<void> {
    this.reset(await firstValueFrom(this.repo.get(versionId)));
  }

  select(id: string | null): void {
    this._selectedId.set(id);
  }

  setStep(step: SnapStep): void {
    this._step.set(step);
  }

  add(kind: LayoutObjectKind, at: Point): void {
    const id = this.newId();
    if (this.apply((objs, ctx) => addObject(objs, kind, at, ctx, id))) this._selectedId.set(id);
  }

  move(id: string, to: Point): void {
    this.apply((objs, ctx) => moveObject(objs, id, to, ctx));
  }

  resize(id: string, handle: ResizeHandle, to: Point): void {
    this.apply((objs, ctx) => resizeObject(objs, id, handle, to, ctx));
  }

  rotate(id: string): void {
    this.apply((objs, ctx) => rotate90(objs, id, ctx));
  }

  duplicate(id: string): void {
    const newId = this.newId();
    if (this.apply((objs, ctx) => duplicateObject(objs, id, ctx, newId)))
      this._selectedId.set(newId);
  }

  remove(id: string): void {
    this.apply((objs) => removeObject(objs, id));
  }

  updateProps(id: string, patch: ObjectPatch): void {
    this.apply((objs, ctx) => updateProps(objs, id, patch, ctx));
  }

  beginGesture(): void {
    if (!this.isReadOnly()) this.gestureBase = this.objects();
  }

  commitGesture(): void {
    const base = this.gestureBase;
    this.gestureBase = null;
    if (base && base !== this.objects()) this.pushHistory(base);
  }

  cancelGesture(): void {
    const base = this.gestureBase;
    this.gestureBase = null;
    if (base && base !== this.objects()) this.setObjects(base);
  }

  undo(): void {
    if (!this.canUndo()) return;
    const past = this._past();
    this._future.update((f) => [this.objects(), ...f]);
    this._past.set(past.slice(0, -1));
    this.setObjects(past[past.length - 1]);
  }

  redo(): void {
    if (!this.canRedo()) return;
    const [next, ...rest] = this._future();
    this._past.update((p) => [...p, this.objects()]);
    this._future.set(rest);
    this.setObjects(next);
  }

  async save(): Promise<void> {
    const version = this._version();
    if (!version || this.isReadOnly()) return;
    this._version.set(await firstValueFrom(this.repo.saveDraft(version)));
    this._dirty.set(false);
  }

  /** Saves pending changes, then publishes. Returns false when blocked locally or rejected by the server. */
  async publish(): Promise<boolean> {
    const version = this._version();
    if (!version || !this.canPublish()) return false;
    if (this._dirty()) await this.save();
    try {
      this.reset(await firstValueFrom(this.repo.publish(version.id)));
      return true;
    } catch (error: unknown) {
      if (error instanceof PublishRejectedError) {
        this._serverIssues.set(error.issues);
        return false;
      }
      throw error;
    }
  }

  /** Published/archived versions are immutable (INV-06): editing means cloning into a new draft. */
  async createNewVersion(): Promise<void> {
    const version = this._version();
    if (!version) return;
    this.reset(await firstValueFrom(this.repo.cloneAsDraft(version.id)));
  }

  private apply(command: (objects: Objects, ctx: EditContext) => Objects): boolean {
    if (this.isReadOnly()) return false;
    const current = this.objects();
    const next = command(current, this.ctx());
    if (next === current) return false;
    if (!this.gestureBase) this.pushHistory(current);
    this.setObjects(next);
    return true;
  }

  private pushHistory(snapshot: Objects): void {
    this._past.update((p) => [...p, snapshot].slice(-HISTORY_LIMIT));
    this._future.set([]);
  }

  private setObjects(objects: Objects): void {
    this._version.update((v) => (v ? { ...v, objects } : v));
    this._dirty.set(true);
    this._serverIssues.set([]);
    const selected = this._selectedId();
    if (selected && !objects.some((o) => o.id === selected)) this._selectedId.set(null);
  }

  private reset(version: LayoutVersionDto): void {
    this._version.set(version);
    this._past.set([]);
    this._future.set([]);
    this._selectedId.set(null);
    this._dirty.set(false);
    this._serverIssues.set([]);
    this.gestureBase = null;
  }
}

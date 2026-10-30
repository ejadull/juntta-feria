import type { ResizeHandle } from '../domain/commands';
import { fromPolygon } from '../domain/geometry';
import type { LayoutObjectDto, Rect } from '../domain/layout.types';
import { KIND_LABEL } from '../domain/validation';
import type { LayoutEditorStore } from './layout-editor.store';

/**
 * Edit intents shared by keyboard shortcuts and buttons. Moves/resizes are in steps:
 * one snap step, or 1 m when `large`.
 */
export type EditorAction =
  | { readonly type: 'move'; readonly dx: number; readonly dy: number; readonly large: boolean }
  | { readonly type: 'resize'; readonly dw: number; readonly dh: number; readonly large: boolean }
  | { readonly type: 'rotate' | 'duplicate' | 'remove' | 'undo' | 'redo' };

/** What happened, in words for the aria-live region, and where focus should go next. */
export interface ActionResult {
  readonly message: string;
  readonly focus?: { readonly id: string } | 'plan';
}

export function objectName(o: LayoutObjectDto): string {
  const code = o.code?.trim();
  if (code) return code;
  return o.kind === 'STAND' ? 'Stand sin código' : KIND_LABEL[o.kind];
}

const size = (r: Rect): string => `${r.w} × ${r.h} m`;

/** Runs the action on the store. Returns null when nothing changed (e.g. arrow against a wall). */
export function runEditorAction(
  store: LayoutEditorStore,
  action: EditorAction,
): ActionResult | null {
  if (action.type === 'undo')
    return changed(store, () => store.undo()) ? { message: 'Deshecho.' } : null;
  if (action.type === 'redo')
    return changed(store, () => store.redo()) ? { message: 'Rehecho.' } : null;

  const target = store.selected();
  if (!target) return null;
  const name = objectName(target);

  if (action.type === 'remove') {
    return changed(store, () => store.remove(target.id))
      ? { message: `${name} borrado.`, focus: 'plan' }
      : null;
  }
  if (action.type === 'duplicate') {
    if (!changed(store, () => store.duplicate(target.id))) return null;
    const copy = store.selected();
    return copy
      ? { message: `${name} duplicado como ${objectName(copy)}.`, focus: { id: copy.id } }
      : null;
  }

  const rect = fromPolygon(target.geometry);
  if (!rect) return null; // free polygons are geometry-locked
  const after = () => fromPolygon(store.selected()!.geometry)!;

  switch (action.type) {
    case 'move': {
      const unit = action.large ? 1 : store.step();
      const to = { x: rect.x + action.dx * unit, y: rect.y + action.dy * unit };
      if (!changed(store, () => store.move(target.id, to))) return null;
      const r = after();
      return { message: `${name} movido a ${r.x}, ${r.y} m.` };
    }
    case 'resize': {
      const unit = action.large ? 1 : store.step();
      const handle: ResizeHandle = action.dw !== 0 ? 'e' : 's';
      const to = { x: rect.x + rect.w + action.dw * unit, y: rect.y + rect.h + action.dh * unit };
      if (!changed(store, () => store.resize(target.id, handle, to))) return null;
      return { message: `${name} redimensionado a ${size(after())}.` };
    }
    case 'rotate':
      if (!changed(store, () => store.rotate(target.id))) return null;
      return { message: `${name} rotado: ${size(after())}.` };
  }
}

function changed(store: LayoutEditorStore, run: () => void): boolean {
  const before = store.objects();
  run();
  return store.objects() !== before;
}

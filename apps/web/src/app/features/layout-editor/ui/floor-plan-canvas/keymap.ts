/** Keyboard shortcuts of the editor (design D7) as pure data: key → intent. */
import type { EditorAction } from '../../state/editor-actions';

export type KeyInput = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>;

/** Edit intents go to the page; zoom and deselect are handled by the canvas itself. */
export type KeyAction =
  | EditorAction
  | { readonly type: 'deselect' }
  | { readonly type: 'zoom'; readonly dir: 'in' | 'out' | 'reset' };

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

export function keyToAction(e: KeyInput): KeyAction | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  const arrow = ARROWS[key];
  if (arrow && !mod) {
    const [x, y] = arrow;
    return e.altKey
      ? { type: 'resize', dw: x, dh: y, large: e.shiftKey }
      : { type: 'move', dx: x, dy: y, large: e.shiftKey };
  }

  if (mod) {
    if (key === 'z') return { type: e.shiftKey ? 'redo' : 'undo' };
    if (key === 'y') return { type: 'redo' };
    if (key === 'd') return { type: 'duplicate' };
    return null; // leave other Ctrl/Cmd combos to the browser
  }

  switch (key) {
    case 'r':
      return { type: 'rotate' };
    case 'Delete':
    case 'Backspace':
      return { type: 'remove' };
    case '+':
    case '=':
      return { type: 'zoom', dir: 'in' };
    case '-':
      return { type: 'zoom', dir: 'out' };
    case '0':
      return { type: 'zoom', dir: 'reset' };
    case 'Escape':
      return { type: 'deselect' };
    default:
      return null;
  }
}

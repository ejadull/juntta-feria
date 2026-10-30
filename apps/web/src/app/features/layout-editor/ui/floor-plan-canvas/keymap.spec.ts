import { keyToAction, type KeyInput } from './keymap';

const key = (k: string, mods: Partial<Omit<KeyInput, 'key'>> = {}): KeyInput => ({
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe('keyToAction (design D7)', () => {
  it.each([
    ['ArrowRight', {}, { type: 'move', dx: 1, dy: 0, large: false }],
    ['ArrowLeft', {}, { type: 'move', dx: -1, dy: 0, large: false }],
    ['ArrowUp', {}, { type: 'move', dx: 0, dy: -1, large: false }],
    ['ArrowDown', { shiftKey: true }, { type: 'move', dx: 0, dy: 1, large: true }],
    ['ArrowRight', { altKey: true }, { type: 'resize', dw: 1, dh: 0, large: false }],
    ['ArrowUp', { altKey: true, shiftKey: true }, { type: 'resize', dw: 0, dh: -1, large: true }],
    ['r', {}, { type: 'rotate' }],
    ['R', { shiftKey: true }, { type: 'rotate' }],
    ['d', { ctrlKey: true }, { type: 'duplicate' }],
    ['d', { metaKey: true }, { type: 'duplicate' }],
    ['Delete', {}, { type: 'remove' }],
    ['Backspace', {}, { type: 'remove' }],
    ['z', { ctrlKey: true }, { type: 'undo' }],
    ['Z', { ctrlKey: true, shiftKey: true }, { type: 'redo' }],
    ['y', { ctrlKey: true }, { type: 'redo' }],
    ['+', {}, { type: 'zoom', dir: 'in' }],
    ['=', {}, { type: 'zoom', dir: 'in' }],
    ['-', {}, { type: 'zoom', dir: 'out' }],
    ['0', {}, { type: 'zoom', dir: 'reset' }],
    ['Escape', {}, { type: 'deselect' }],
  ] as const)('%s %o → %o', (k, mods, expected) => {
    expect(keyToAction(key(k, mods))).toEqual(expected);
  });

  it.each([
    ['a', {}],
    ['r', { ctrlKey: true }], // Ctrl+R is the browser reload
    ['0', { ctrlKey: true }], // Ctrl+0 is the browser zoom reset
    ['d', {}],
    ['Tab', {}],
  ] as const)('ignores %s %o', (k, mods) => {
    expect(keyToAction(key(k, mods))).toBeNull();
  });
});

import { TestBed } from '@angular/core/testing';
import { firstValueFrom, throwError } from 'rxjs';
import { DEMO_LAYOUT } from '../data/demo-layout';
import { InMemoryLayoutRepository } from '../data/in-memory-layout.repository';
import { LayoutRepository, PublishRejectedError } from '../data/layout.repository';
import { fromPolygon, toPolygon } from '../domain/geometry';
import type { LayoutObjectDto, LayoutVersionDto, Rect } from '../domain/layout.types';
import type { ValidationIssue } from '../domain/validation';
import { HISTORY_LIMIT, ID_GENERATOR, LayoutEditorStore } from './layout-editor.store';

const stand = (id: string, rect: Rect): LayoutObjectDto => ({
  id,
  kind: 'STAND',
  code: id,
  geometry: toPolygon(rect),
  metadata: {},
});

const DRAFT: LayoutVersionDto = {
  id: 'v1',
  templateId: 't1',
  version: 1,
  status: 'DRAFT',
  widthM: 100,
  heightM: 60,
  objects: [stand('A01', { x: 0, y: 0, w: 3, h: 3 }), stand('A02', { x: 10, y: 0, w: 3, h: 3 })],
};
const PUBLISHED: LayoutVersionDto = { ...DRAFT, id: 'p1', status: 'PUBLISHED' };

function setup(
  repo: LayoutRepository = new InMemoryLayoutRepository([DRAFT, PUBLISHED, DEMO_LAYOUT]),
) {
  let n = 0;
  TestBed.configureTestingModule({
    providers: [
      LayoutEditorStore,
      { provide: LayoutRepository, useValue: repo },
      { provide: ID_GENERATOR, useValue: () => `new-${++n}` },
    ],
  });
  return { store: TestBed.inject(LayoutEditorStore), repo };
}

const rectOf = (store: LayoutEditorStore, id: string): Rect | null => {
  const o = store.objects().find((x) => x.id === id);
  return o ? fromPolygon(o.geometry) : null;
};

describe('LayoutEditorStore', () => {
  it('starts empty and read-only until a version is loaded', () => {
    const { store } = setup();
    expect(store.version()).toBeNull();
    expect(store.isReadOnly()).toBe(true);
    expect(store.canPublish()).toBe(false);
  });

  it('loads a draft and derives validation', async () => {
    const { store } = setup();
    await store.load('v1');
    expect(store.version()?.id).toBe('v1');
    expect(store.isReadOnly()).toBe(false);
    expect(store.validation()).toEqual([]);
    expect(store.canPublish()).toBe(true);
  });

  describe('commands and history', () => {
    it('applies a command and undoes/redoes it', async () => {
      const { store } = setup();
      await store.load('v1');
      store.move('A01', { x: 20, y: 20 });
      expect(rectOf(store, 'A01')).toMatchObject({ x: 20, y: 20 });
      expect(store.isDirty()).toBe(true);

      store.undo();
      expect(rectOf(store, 'A01')).toMatchObject({ x: 0, y: 0 });
      store.redo();
      expect(rectOf(store, 'A01')).toMatchObject({ x: 20, y: 20 });
    });

    it('a new command clears the redo stack', async () => {
      const { store } = setup();
      await store.load('v1');
      store.move('A01', { x: 20, y: 20 });
      store.undo();
      store.move('A02', { x: 30, y: 30 });
      expect(store.canRedo()).toBe(false);
    });

    it('no-op commands do not create history', async () => {
      const { store } = setup();
      await store.load('v1');
      store.move('A01', { x: 0, y: 0 });
      store.move('missing', { x: 5, y: 5 });
      expect(store.canUndo()).toBe(false);
    });

    it(`keeps at most ${HISTORY_LIMIT} undo steps`, async () => {
      const { store } = setup();
      await store.load('v1');
      for (let i = 1; i <= HISTORY_LIMIT + 20; i++) store.move('A01', { x: i % 2 ? 20 : 30, y: 0 });
      let undos = 0;
      while (store.canUndo()) {
        store.undo();
        undos++;
      }
      expect(undos).toBe(HISTORY_LIMIT);
    });

    it('a drag is a single history step (spec: "Un drag es un único paso de historial")', async () => {
      const { store } = setup();
      await store.load('v1');
      store.beginGesture();
      for (let i = 1; i <= 40; i++) store.move('A01', { x: i, y: i / 2 });
      store.commitGesture();

      store.undo();
      expect(rectOf(store, 'A01')).toMatchObject({ x: 0, y: 0 });
      expect(store.canUndo()).toBe(false);
    });

    it('a gesture with no change leaves no history', async () => {
      const { store } = setup();
      await store.load('v1');
      store.beginGesture();
      store.commitGesture();
      expect(store.canUndo()).toBe(false);
    });

    it('cancelGesture restores the pre-gesture state', async () => {
      const { store } = setup();
      await store.load('v1');
      store.beginGesture();
      store.move('A01', { x: 50, y: 50 });
      store.cancelGesture();
      expect(rectOf(store, 'A01')).toMatchObject({ x: 0, y: 0 });
      expect(store.canUndo()).toBe(false);
    });
  });

  describe('selection', () => {
    it('selects added and duplicated objects, deselects removed ones', async () => {
      const { store } = setup();
      await store.load('v1');

      store.add('STAND', { x: 40, y: 40 });
      expect(store.selected()?.id).toBe('new-1');

      store.duplicate('A01');
      expect(store.selected()?.id).toBe('new-2');
      expect(store.selected()?.code).toBe('A03');

      store.remove('new-2');
      expect(store.selected()).toBeNull();
    });

    it('drops the selection if an undo removes the selected object', async () => {
      const { store } = setup();
      await store.load('v1');
      store.add('STAND', { x: 40, y: 40 });
      store.undo();
      expect(store.selected()).toBeNull();
    });
  });

  it('wires resize, rotate, updateProps and select to the domain commands', async () => {
    const { store } = setup();
    await store.load('v1');

    store.resize('A01', 'se', { x: 4, y: 5 });
    expect(rectOf(store, 'A01')).toEqual({ x: 0, y: 0, w: 4, h: 5 });
    store.rotate('A01');
    expect(rectOf(store, 'A01')).toEqual({ x: 0, y: 0.5, w: 5, h: 4 });
    store.updateProps('A01', { code: 'Z99' });
    store.select('A01');
    expect(store.selected()?.code).toBe('Z99');
    store.select(null);
    expect(store.selected()).toBeNull();
  });

  it('uses the configured snap step', async () => {
    const { store } = setup();
    await store.load('v1');
    store.setStep(0.25);
    store.move('A01', { x: 10.37, y: 0 });
    expect(rectOf(store, 'A01')?.x).toBe(10.25);
  });

  it('blocks publish while there are validation errors', async () => {
    const { store } = setup();
    await store.load('v1');
    store.move('A02', { x: 1, y: 0 });
    expect(store.validation().map((i) => i.code)).toEqual(['STAND_OVERLAP']);
    expect(store.canPublish()).toBe(false);
    expect(await store.publish()).toBe(false);
  });

  describe('read-only versions (INV-06)', () => {
    it('ignores every edit on a published version (spec: "Publicada no editable")', async () => {
      const { store } = setup();
      await store.load('p1');
      expect(store.isReadOnly()).toBe(true);

      store.move('A01', { x: 20, y: 20 });
      store.add('STAND', { x: 40, y: 40 });
      store.remove('A01');
      expect(store.objects()).toBe(PUBLISHED.objects);
      expect(store.canPublish()).toBe(false);
    });

    it('creates a new editable version without altering the published one', async () => {
      const { store, repo } = setup();
      await store.load('p1');
      await store.createNewVersion();

      expect(store.version()).toMatchObject({ status: 'DRAFT', version: 2 });
      const movedId = store.objects()[0].id;
      store.move(movedId, { x: 50, y: 50 });
      await store.save();

      const original = await firstValueFrom(repo.get('p1'));
      expect(fromPolygon(original.objects[0].geometry)).toMatchObject({ x: 0, y: 0 });
    });
  });

  describe('save and publish', () => {
    it('saves pending changes before publishing', async () => {
      const { store, repo } = setup();
      await store.load('v1');
      store.move('A01', { x: 50, y: 50 });

      expect(await store.publish()).toBe(true);
      expect(store.version()?.status).toBe('PUBLISHED');
      expect(store.isReadOnly()).toBe(true);
      expect(store.isDirty()).toBe(false);

      const stored = await firstValueFrom(repo.get('v1'));
      expect(fromPolygon(stored.objects[0].geometry)).toMatchObject({ x: 50, y: 50 });
    });

    it('shows server issues and stays DRAFT when the backend rejects (spec: "Validación frontend no es autoridad")', async () => {
      const serverIssues: ValidationIssue[] = [
        {
          code: 'STAND_OVERLAP',
          severity: 'error',
          objectIds: ['A01', 'A02'],
          message: 'rechazado por el servidor',
        },
      ];
      const base = new InMemoryLayoutRepository([DRAFT]);
      const rejecting = Object.assign(Object.create(base) as InMemoryLayoutRepository, {
        publish: () => throwError(() => new PublishRejectedError(serverIssues)),
      });
      const { store } = setup(rejecting);
      await store.load('v1');

      expect(await store.publish()).toBe(false);
      expect(store.version()?.status).toBe('DRAFT');
      expect(store.serverIssues()).toEqual(serverIssues);

      store.move('A01', { x: 40, y: 40 });
      expect(store.serverIssues()).toEqual([]);
    });
  });
});

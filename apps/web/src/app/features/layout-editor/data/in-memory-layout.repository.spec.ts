import { firstValueFrom } from 'rxjs';
import { moveObject } from '../domain/commands';
import { validateLayout } from '../domain/validation';
import type { LayoutVersionDto } from '../domain/layout.types';
import { DEMO_LAYOUT } from './demo-layout';
import { InMemoryLayoutRepository } from './in-memory-layout.repository';
import {
  LayoutNotEditableError,
  LayoutNotFoundError,
  PublishRejectedError,
} from './layout.repository';

const ctx = { bounds: { widthM: 100, heightM: 60 }, step: 0.5 };

function makeRepo(seed: readonly LayoutVersionDto[] = [DEMO_LAYOUT]): InMemoryLayoutRepository {
  let n = 0;
  return new InMemoryLayoutRepository(seed, () => `gen-${++n}`);
}

describe('DEMO_LAYOUT', () => {
  it('is a valid 100x60 m draft with 40 stands', () => {
    expect(DEMO_LAYOUT).toMatchObject({ status: 'DRAFT', widthM: 100, heightM: 60 });
    expect(DEMO_LAYOUT.objects.filter((o) => o.kind === 'STAND')).toHaveLength(40);
    expect(validateLayout(DEMO_LAYOUT)).toEqual([]);
  });
});

describe('InMemoryLayoutRepository', () => {
  it('gets a version by id', async () => {
    expect(await firstValueFrom(makeRepo().get(DEMO_LAYOUT.id))).toBe(DEMO_LAYOUT);
  });

  it('fails with LayoutNotFoundError for unknown ids', async () => {
    await expect(firstValueFrom(makeRepo().get('nope'))).rejects.toBeInstanceOf(
      LayoutNotFoundError,
    );
  });

  it('saves draft objects but ignores client-side status/version changes', async () => {
    const repo = makeRepo();
    const edited: LayoutVersionDto = {
      ...DEMO_LAYOUT,
      status: 'PUBLISHED',
      version: 99,
      objects: moveObject(DEMO_LAYOUT.objects, DEMO_LAYOUT.objects[0].id, { x: 60, y: 52 }, ctx),
    };
    const saved = await firstValueFrom(repo.saveDraft(edited));
    expect(saved).toMatchObject({ status: 'DRAFT', version: DEMO_LAYOUT.version });
    expect(saved.objects).toBe(edited.objects);
  });

  it('refuses to save a published version (INV-06)', async () => {
    const published: LayoutVersionDto = { ...DEMO_LAYOUT, id: 'pub', status: 'PUBLISHED' };
    await expect(firstValueFrom(makeRepo([published]).saveDraft(published))).rejects.toBeInstanceOf(
      LayoutNotEditableError,
    );
  });

  it('publishes a valid draft', async () => {
    const repo = makeRepo();
    const published = await firstValueFrom(repo.publish(DEMO_LAYOUT.id));
    expect(published.status).toBe('PUBLISHED');
    expect((await firstValueFrom(repo.get(DEMO_LAYOUT.id))).status).toBe('PUBLISHED');
  });

  it('rejects publishing an invalid draft with the issues', async () => {
    const empty: LayoutVersionDto = { ...DEMO_LAYOUT, id: 'empty', objects: [] };
    const error = await firstValueFrom(makeRepo([empty]).publish('empty')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublishRejectedError);
    expect((error as PublishRejectedError).issues.map((i) => i.code)).toEqual(['NO_STANDS']);
  });

  it('clones a version as the next draft with fresh object ids, leaving the source untouched (AC-04)', async () => {
    const repo = makeRepo();
    const source = await firstValueFrom(repo.publish(DEMO_LAYOUT.id));
    const draft = await firstValueFrom(repo.cloneAsDraft(source));

    expect(draft).toMatchObject({
      status: 'DRAFT',
      version: source.version + 1,
      templateId: source.templateId,
    });
    expect(draft.id).not.toBe(source.id);
    expect(draft.objects.map((o) => o.geometry)).toEqual(source.objects.map((o) => o.geometry));
    expect(draft.objects.some((o) => source.objects.some((s) => s.id === o.id))).toBe(false);
    expect(await firstValueFrom(repo.get(source.id))).toBe(source);
  });
});

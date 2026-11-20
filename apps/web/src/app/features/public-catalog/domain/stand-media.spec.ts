import { galleryOf, standForPublication } from './stand-media';
import type { StandView } from './stand-filters';

const media = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  kind: 'IMAGE' as const,
  url: `https://files.test/${id}`,
  alt: '',
  caption: `Texto ${id}`,
  durationS: null,
  ...patch,
});

const exhibitor = {
  name: 'Chacra El Origen',
  category: 'Productores',
  description: null,
  photos: [{ url: 'https://files.test/perfil', alt: 'Telar' }],
  media: [media('m1'), media('m2', { kind: 'VIDEO', durationS: 45 })],
};

const stand = (id: string, exh: typeof exhibitor | null): StandView =>
  ({ id, code: id.toUpperCase(), status: 'OCCUPIED', exhibitor: exh }) as unknown as StandView;

describe('galleryOf', () => {
  it('lists publications first, then profile photos, with captions and kinds', () => {
    expect(galleryOf(exhibitor, null).map((i) => [i.id, i.kind])).toEqual([
      ['m1', 'IMAGE'],
      ['m2', 'VIDEO'],
      ['profile-0', 'IMAGE'],
    ]);
  });

  it('puts the publication linked from a share link first', () => {
    expect(galleryOf(exhibitor, 'm2')[0].id).toBe('m2');
  });

  it('gives every image a text alternative (its caption, or the exhibitor name)', () => {
    const items = galleryOf(exhibitor, null);
    expect(items[0].alt).toBe('Texto m1');
    expect(items[2].alt).toBe('Telar');
  });

  it('is empty without an exhibitor', () => {
    expect(galleryOf(null, null)).toEqual([]);
  });
});

describe('standForPublication', () => {
  it('finds the stand whose exhibitor published that item', () => {
    const stands = [stand('s1', null), stand('s2', exhibitor)];
    expect(standForPublication(stands, 'm2')?.id).toBe('s2');
  });

  it('returns null for an unknown publication', () => {
    expect(standForPublication([stand('s2', exhibitor)], 'nope')).toBeNull();
  });
});

import {
  photoFallbackAlt,
  publicExhibitorOf,
  type PublicMedia,
  type PublicPhoto,
  type StandExhibitorRow,
} from './public-exhibitor.js';

const photo: PublicPhoto = { url: 'https://cdn.test/a?sig=1', alt: 'Telar' };
const photos = new Map<string, readonly PublicPhoto[]>([['ex-1', [photo]]]);
const row: StandExhibitorRow = {
  reservationOwns: true,
  consented: true,
  exhibitorId: 'ex-1',
  name: 'Telares Sur',
  category: 'Textiles',
  description: '  Tejidos  ',
};

describe('publicExhibitorOf (consent gating, AC-11 / INV-08)', () => {
  it('publishes name, category, description and photos with consent', () => {
    expect(publicExhibitorOf(row, photos)).toEqual({
      name: 'Telares Sur',
      category: 'Textiles',
      description: 'Tejidos',
      photos: [photo],
      media: [],
    });
  });

  it('publishes the publications of this event, with no storage key', () => {
    const video: PublicMedia = {
      id: 'm-1',
      kind: 'VIDEO',
      url: 'https://cdn.test/v?sig=1',
      alt: 'Así se hace',
      caption: 'Así se hace',
      durationS: 45,
    };
    const media = new Map<string, readonly PublicMedia[]>([['ex-1', [video]]]);
    const exhibitor = publicExhibitorOf(row, photos, media);
    expect(exhibitor!.media).toEqual([video]);
    expect(Object.keys(exhibitor!.media[0]).sort()).toEqual([
      'alt',
      'caption',
      'durationS',
      'id',
      'kind',
      'url',
    ]);
  });

  it('publishes no publications without consent, even when they exist', () => {
    const media = new Map<string, readonly PublicMedia[]>([['ex-1', []]]);
    expect(publicExhibitorOf({ ...row, consented: false }, photos, media)).toBeNull();
  });

  it('publishes nothing without consent, even when photos exist', () => {
    expect(publicExhibitorOf({ ...row, consented: false }, photos)).toBeNull();
    expect(publicExhibitorOf({ ...row, consented: null }, photos)).toBeNull();
  });

  it('publishes nothing when the stand is only held, not owned', () => {
    expect(
      publicExhibitorOf({ ...row, reservationOwns: false }, photos),
    ).toBeNull();
  });

  it('returns an empty gallery and null description when there is none', () => {
    expect(
      publicExhibitorOf({ ...row, description: ' ' }, new Map()),
    ).toMatchObject({ description: null, photos: [] });
  });

  it('only carries url and alt per photo (no storage keys)', () => {
    const exhibitor = publicExhibitorOf(row, photos);
    expect(JSON.stringify(exhibitor)).not.toContain('storageKey');
    expect(Object.keys(exhibitor!.photos[0]).sort()).toEqual(['alt', 'url']);
  });
});

describe('photoFallbackAlt', () => {
  it('names the exhibitor so the image is never unlabeled', () => {
    expect(photoFallbackAlt('Telares Sur')).toBe(
      'Foto del stand de Telares Sur',
    );
  });
});

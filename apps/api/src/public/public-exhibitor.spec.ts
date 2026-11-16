import {
  photoFallbackAlt,
  publicExhibitorOf,
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
    });
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

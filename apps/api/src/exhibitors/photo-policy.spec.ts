import { requestPhotoInput } from './photo.input.js';
import { MAX_PHOTO_BYTES, photoKey } from './photo-policy.js';

const T = '11111111-1111-4111-8111-111111111111';
const E = '22222222-2222-4222-8222-222222222222';
const P = '33333333-3333-4333-8333-333333333333';

describe('photoKey', () => {
  it('builds a key under the tenant and exhibitor', () => {
    expect(photoKey(T, E, P)).toBe(`tenants/${T}/exhibitors/${E}/photos/${P}`);
  });

  it('rejects parts that are not UUIDs (no path traversal)', () => {
    expect(() => photoKey(T, '../x', P)).toThrow();
    expect(() => photoKey('t', E, P)).toThrow();
  });
});

describe('requestPhotoInput', () => {
  const ok = { contentType: 'image/webp', sizeBytes: 1024 };

  it('accepts jpeg, png and webp up to 5 MB, with optional alt', () => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/webp'])
      expect(requestPhotoInput.safeParse({ ...ok, contentType }).success).toBe(
        true,
      );
    expect(
      requestPhotoInput.parse({
        ...ok,
        sizeBytes: MAX_PHOTO_BYTES,
        alt: ' Telar ',
      }).alt,
    ).toBe('Telar');
  });

  it.each([
    ['gif', { ...ok, contentType: 'image/gif' }],
    ['svg', { ...ok, contentType: 'image/svg+xml' }],
    ['too big', { ...ok, sizeBytes: MAX_PHOTO_BYTES + 1 }],
    ['empty', { ...ok, sizeBytes: 0 }],
    ['alt too long', { ...ok, alt: 'x'.repeat(121) }],
    ['unknown field', { ...ok, storageKey: 'a/b' }],
  ])('rejects %s', (_name, body) => {
    expect(requestPhotoInput.safeParse(body).success).toBe(false);
  });
});

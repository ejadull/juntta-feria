import { requestPhotoInput } from './photo.input.js';
import {
  MAX_CAPTION_LENGTH,
  MAX_PHOTO_BYTES,
  MAX_PUBLICATIONS_PER_EVENT,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  canPublishInEvent,
  photoKey,
  validateMediaUpload,
  visibilityAfter,
  isRetentionDue,
} from './photo-policy.js';

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

describe('publication limits (MED-02)', () => {
  const EV = '44444444-4444-4444-8444-444444444444';
  const image = { kind: 'IMAGE', contentType: 'image/jpeg', sizeBytes: 3 * 1024 * 1024, caption: 'Mermelada de ciruela', eventId: EV, durationS: null } as const;
  const video = { kind: 'VIDEO', contentType: 'video/mp4', sizeBytes: 40 * 1024 * 1024, caption: 'Así se hace', eventId: EV, durationS: 45 } as const;

  it('exposes the agreed limits', () => {
    expect(MAX_VIDEO_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_VIDEO_SECONDS).toBe(60);
    expect(MAX_CAPTION_LENGTH).toBe(200);
    expect(MAX_PUBLICATIONS_PER_EVENT).toBe(10);
  });

  it('accepts an image publication and a valid MP4 or WebM video', () => {
    expect(validateMediaUpload(image)).toEqual({ ok: true });
    expect(validateMediaUpload(video)).toEqual({ ok: true });
    expect(validateMediaUpload({ ...video, contentType: 'video/webm' })).toEqual({ ok: true });
  });

  it('rejects video formats that are not played without conversion', () => {
    for (const contentType of ['video/quicktime', 'video/x-msvideo', 'video/ogg'])
      expect(validateMediaUpload({ ...video, contentType })).toMatchObject({ ok: false, reason: 'FORMAT' });
  });

  it('rejects a video longer than 60 seconds or without a duration', () => {
    expect(validateMediaUpload({ ...video, durationS: MAX_VIDEO_SECONDS + 1 })).toMatchObject({ ok: false, reason: 'DURATION' });
    expect(validateMediaUpload({ ...video, durationS: 0 })).toMatchObject({ ok: false, reason: 'DURATION' });
    expect(validateMediaUpload({ ...video, durationS: null })).toMatchObject({ ok: false, reason: 'DURATION' });
  });

  it('enforces 5 MB for images and 50 MB for videos', () => {
    expect(validateMediaUpload({ ...image, sizeBytes: MAX_PHOTO_BYTES + 1 })).toMatchObject({ ok: false, reason: 'SIZE' });
    expect(validateMediaUpload({ ...video, sizeBytes: MAX_VIDEO_BYTES })).toEqual({ ok: true });
    expect(validateMediaUpload({ ...video, sizeBytes: MAX_VIDEO_BYTES + 1 })).toMatchObject({ ok: false, reason: 'SIZE' });
  });

  it('rejects captions over 200 characters', () => {
    expect(validateMediaUpload({ ...image, caption: 'x'.repeat(MAX_CAPTION_LENGTH + 1) })).toMatchObject({ ok: false, reason: 'CAPTION' });
  });

  it('requires an event for any video or captioned image', () => {
    expect(validateMediaUpload({ ...video, eventId: null })).toMatchObject({ ok: false, reason: 'EVENT' });
    expect(validateMediaUpload({ ...image, eventId: null })).toMatchObject({ ok: false, reason: 'EVENT' });
  });

  it('rejects a duration on an image', () => {
    expect(validateMediaUpload({ ...image, durationS: 10 })).toMatchObject({ ok: false, reason: 'DURATION' });
  });

  it('allows up to 10 publications per exhibitor and event', () => {
    expect(canPublishInEvent(MAX_PUBLICATIONS_PER_EVENT - 1)).toBe(true);
    expect(canPublishInEvent(MAX_PUBLICATIONS_PER_EVENT)).toBe(false);
  });
});

describe('requestPhotoInput for publications (MED-03)', () => {
  const EV = '44444444-4444-4444-8444-444444444444';
  const video = { contentType: 'video/mp4', sizeBytes: 40 * 1024 * 1024, eventId: EV, durationS: 45, caption: 'Así se hace' };

  it('accepts a video publication with event, duration and caption', () => {
    expect(requestPhotoInput.safeParse(video).success).toBe(true);
  });

  it('keeps profile photos without event or caption', () => {
    expect(requestPhotoInput.safeParse({ contentType: 'image/png', sizeBytes: 1024 }).success).toBe(true);
  });

  it.each([
    ['video without event', { ...video, eventId: undefined }],
    ['video without duration', { ...video, durationS: undefined }],
    ['video too long', { ...video, durationS: 61 }],
    ['video over 50 MB', { ...video, sizeBytes: 50 * 1024 * 1024 + 1 }],
    ['quicktime video', { ...video, contentType: 'video/quicktime' }],
    ['caption over 200', { ...video, caption: 'x'.repeat(201) }],
    ['image with duration', { contentType: 'image/jpeg', sizeBytes: 1024, durationS: 5 }],
    ['event id not a uuid', { ...video, eventId: 'no-uuid' }],
  ])('rejects %s', (_name, body) => {
    expect(requestPhotoInput.safeParse(body).success).toBe(false);
  });
});

describe('visibility of a publication (MED-11)', () => {
  it('hides a published publication and shows a hidden one again', () => {
    expect(visibilityAfter('READY', true)).toBe('HIDDEN');
    expect(visibilityAfter('HIDDEN', false)).toBe('READY');
  });

  it('keeps the status when asked for what it already is', () => {
    expect(visibilityAfter('READY', false)).toBe('READY');
    expect(visibilityAfter('HIDDEN', true)).toBe('HIDDEN');
  });

  it('refuses to change an upload that is not published yet', () => {
    expect(visibilityAfter('PENDING', true)).toBeNull();
  });
});

describe('publication retention (MED-12)', () => {
  const ends = new Date('2026-11-15T23:00:00-03:00');
  const DAY = 24 * 60 * 60 * 1000;

  it('is due once the event has ended, with no retention days by default', () => {
    expect(isRetentionDue(ends, 0, new Date(ends.getTime() + 1))).toBe(true);
    expect(isRetentionDue(ends, 0, new Date(ends.getTime() - 1))).toBe(false);
  });

  it('waits the configured days after the event ends', () => {
    expect(isRetentionDue(ends, 7, new Date(ends.getTime() + 7 * DAY - 1))).toBe(false);
    expect(isRetentionDue(ends, 7, new Date(ends.getTime() + 7 * DAY))).toBe(true);
  });
});

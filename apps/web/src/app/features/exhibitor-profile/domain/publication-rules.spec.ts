import {
  MAX_PUBLICATIONS_PER_EVENT,
  canPublishInEvent,
  publicationProblem,
} from './publication-rules';

const MB = 1024 * 1024;

describe('publicationProblem', () => {
  it('accepts images up to 5 MB and videos up to 50 MB and 60 seconds', () => {
    expect(publicationProblem({ type: 'image/jpeg', size: 3 * MB }, null)).toBeNull();
    expect(publicationProblem({ type: 'video/mp4', size: 40 * MB }, 45)).toBeNull();
    expect(publicationProblem({ type: 'video/webm', size: 50 * MB }, 60)).toBeNull();
  });

  it('rejects video formats that browsers only play after conversion', () => {
    const message = publicationProblem({ type: 'video/quicktime', size: 10 * MB }, 10);
    expect(message).toContain('MP4 H.264 o un WebM');
  });

  it('rejects a video longer than 60 seconds, shorter than 1, or without a readable duration', () => {
    expect(publicationProblem({ type: 'video/mp4', size: MB }, 61)).toContain('entre 1 y 60');
    expect(publicationProblem({ type: 'video/mp4', size: MB }, 0)).toContain('entre 1 y 60');
    expect(publicationProblem({ type: 'video/mp4', size: MB }, null)).toContain('duración');
  });

  it('rejects files over the size limit for their kind', () => {
    expect(publicationProblem({ type: 'image/png', size: 5 * MB + 1 }, null)).toContain('5 MB');
    expect(publicationProblem({ type: 'video/mp4', size: 50 * MB + 1 }, 10)).toContain('50 MB');
  });

  it('rejects other image types and empty files', () => {
    expect(publicationProblem({ type: 'image/gif', size: MB }, null)).toContain('JPG, PNG o WebP');
    expect(publicationProblem({ type: 'image/jpeg', size: 0 }, null)).toContain('5 MB');
  });
});

describe('canPublishInEvent', () => {
  it('allows up to the limit per event', () => {
    expect(MAX_PUBLICATIONS_PER_EVENT).toBe(10);
    expect(canPublishInEvent(9)).toBe(true);
    expect(canPublishInEvent(10)).toBe(false);
  });
});

import { rateLimitHeaders } from './rate-limit-headers.js';

const policy = { name: 'public', limit: 120, windowSeconds: 60 };

describe('rateLimitHeaders', () => {
  it('describes the policy and what is left of it (draft-ietf-httpapi-ratelimit-headers-11)', () => {
    expect(rateLimitHeaders(policy, { count: 5, ttl: 42 })).toEqual({
      'RateLimit-Policy': '"public";q=120;w=60',
      RateLimit: '"public";r=115;t=42',
    });
  });

  it('reports zero remaining at the limit and never goes negative past it', () => {
    expect(rateLimitHeaders(policy, { count: 120, ttl: 10 }).RateLimit).toBe(
      '"public";r=0;t=10',
    );
    expect(rateLimitHeaders(policy, { count: 400, ttl: 10 }).RateLimit).toBe(
      '"public";r=0;t=10',
    );
  });

  it('falls back to the whole window when the store reports no TTL', () => {
    expect(rateLimitHeaders(policy, { count: 1, ttl: -1 }).RateLimit).toBe(
      '"public";r=119;t=60',
    );
  });
});

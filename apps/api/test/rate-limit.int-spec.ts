import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { startIntApp } from './int.app.js';

/**
 * Per-IP rate limit of the anonymous routes (spec §8) against the real app: 429 problem+json,
 * Retry-After, the draft RateLimit fields, per-IP buckets and X-Forwarded-For only behind
 * TRUST_PROXY. Redis is replaced by the in-memory counters of int.app.
 */

const PROVIDERS = '/api/v1/auth/providers';
const LIMIT = 3;
const limited = { PUBLIC_RATE_LIMIT: String(LIMIT), WEBHOOK_RATE_LIMIT: '2' };

const get = (
  app: NestFastifyApplication,
  url: string,
  headers: Record<string, string> = {},
  remoteAddress = '192.0.2.10',
) => app.inject({ method: 'GET', url, headers, remoteAddress });

const statusOf = async (
  app: NestFastifyApplication,
  url: string,
  headers: Record<string, string> = {},
  remoteAddress = '192.0.2.10',
) => (await get(app, url, headers, remoteAddress)).statusCode;

describe('public rate limit (no trusted proxy)', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await startIntApp([], [], limited);
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports the quota, then answers 429 problem+json with Retry-After', async () => {
    for (let used = 1; used <= LIMIT; used++) {
      const ok = await get(app, PROVIDERS);
      expect(ok.statusCode).toBe(200);
      expect(ok.headers['ratelimit-policy']).toBe(`"public";q=${LIMIT};w=60`);
      expect(ok.headers['ratelimit']).toBe(`"public";r=${LIMIT - used};t=60`);
    }
    const res = await get(app, PROVIDERS);
    expect(res.statusCode).toBe(429);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.headers['retry-after']).toBe('60');
    expect(res.headers['ratelimit-policy']).toBe(`"public";q=${LIMIT};w=60`);
    expect(res.headers['ratelimit']).toBe('"public";r=0;t=60');
    expect(res.json()).toMatchObject({
      status: 429,
      title: 'Too Many Requests',
      code: 'RATE_LIMITED',
      instance: PROVIDERS,
    });
  });

  it('keeps a bucket per client IP', async () => {
    const other = await get(app, PROVIDERS, {}, '198.51.100.20');
    expect(other.statusCode).toBe(200);
    expect(other.headers['ratelimit']).toBe(`"public";r=${LIMIT - 1};t=60`);
  });

  it('ignores X-Forwarded-For: a client cannot pick its own bucket', async () => {
    // The socket address 192.0.2.10 is already over the limit; a forged header does not help.
    expect(
      await statusOf(app, PROVIDERS, { 'x-forwarded-for': '203.0.113.99' }),
    ).toBe(429);
  });

  it('limits the public catalog, the invitation links and the webhook with their own buckets', async () => {
    const catalog = '/api/v1/public/events';
    for (let i = 0; i < LIMIT; i++)
      expect(await statusOf(app, catalog, {}, '198.51.100.30')).toBe(200);
    expect(await statusOf(app, catalog, {}, '198.51.100.30')).toBe(429);

    const link = '/api/v1/public/invitations/not-a-real-token';
    for (let i = 0; i < LIMIT; i++)
      expect(await statusOf(app, link, {}, '198.51.100.31')).toBe(404);
    expect(await statusOf(app, link, {}, '198.51.100.31')).toBe(429);

    const hook = (remoteAddress: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/mercadopago',
        payload: {},
        remoteAddress,
      });
    // The webhook has its own (WEBHOOK_RATE_LIMIT) bucket, separate from the public one.
    expect((await hook('198.51.100.40')).statusCode).toBe(400);
    expect((await hook('198.51.100.40')).statusCode).toBe(400);
    const blocked = await hook('198.51.100.40');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['ratelimit-policy']).toBe('"webhook";q=2;w=60');
  });
});

describe('public rate limit behind one trusted proxy (TRUST_PROXY=1)', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await startIntApp([], [], { ...limited, TRUST_PROXY: '1' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('buckets by the client address the proxy appended', async () => {
    const as = (client: string) => ({ 'x-forwarded-for': client });
    for (let i = 0; i < LIMIT; i++)
      expect(await statusOf(app, PROVIDERS, as('203.0.113.1'))).toBe(200);
    expect(await statusOf(app, PROVIDERS, as('203.0.113.1'))).toBe(429);
    // Another client behind the same proxy has its own bucket.
    expect(await statusOf(app, PROVIDERS, as('203.0.113.2'))).toBe(200);
  });

  it('cannot be spoofed: only the hop added by the trusted proxy counts', async () => {
    // The client prepends its own fake addresses; the proxy appends the real one last.
    for (let i = 0; i < LIMIT; i++)
      expect(
        await statusOf(app, PROVIDERS, {
          'x-forwarded-for': `10.${i}.0.1, 203.0.113.50`,
        }),
      ).toBe(200);
    expect(
      await statusOf(app, PROVIDERS, {
        'x-forwarded-for': '10.99.0.1, 203.0.113.50',
      }),
    ).toBe(429);
  });
});

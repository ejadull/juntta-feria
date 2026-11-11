import { HttpException, Logger, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CounterStore } from '../auth/login-rate-limiter.js';
import type { AppConfiguration } from '../config/configuration.js';
import { RATE_LIMIT_KEY, RateLimitGuard } from './rate-limit.guard.js';

const env = {
  rateLimits: {
    public: { limit: 2, windowSeconds: 60 },
    webhook: { limit: 5, windowSeconds: 30 },
  },
} as AppConfiguration;

class CountingStore implements CounterStore {
  readonly keys: string[] = [];
  private count = 0;
  async incrementWithWindow(key: string, windowSeconds: number) {
    this.keys.push(key);
    this.count += 1;
    return { count: this.count, ttl: windowSeconds - 5 };
  }
  async reset() {}
}

class Decorated {}
const decorated = () => {};
Reflect.defineMetadata(RATE_LIMIT_KEY, 'public', decorated);

function contextFor(handler: () => void, ip = '203.0.113.7') {
  const headers: Record<string, string> = {};
  const reply = {
    header(name: string, value: string) {
      headers[name] = value;
      return reply;
    },
  };
  const context = {
    getHandler: () => handler,
    getClass: () => Decorated,
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
      getResponse: () => reply,
    }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

const guardWith = (store: CounterStore) =>
  new RateLimitGuard(new Reflector(), store, env);

describe('RateLimitGuard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lets undecorated handlers through without touching the store', async () => {
    const store = new CountingStore();
    const { context, headers } = contextFor(() => {});
    await expect(guardWith(store).canActivate(context)).resolves.toBe(true);
    expect(store.keys).toEqual([]);
    expect(headers).toEqual({});
  });

  it('counts per bucket and client IP and reports the quota on allowed responses', async () => {
    const store = new CountingStore();
    const { context, headers } = contextFor(decorated);
    await expect(guardWith(store).canActivate(context)).resolves.toBe(true);
    expect(store.keys).toEqual(['ratelimit:public:203.0.113.7']);
    expect(headers).toEqual({
      'RateLimit-Policy': '"public";q=2;w=60',
      RateLimit: '"public";r=1;t=55',
    });
  });

  it('answers 429 RATE_LIMITED with Retry-After once the limit is exceeded', async () => {
    const guard = guardWith(new CountingStore());
    await guard.canActivate(contextFor(decorated).context);
    await guard.canActivate(contextFor(decorated).context);
    const { context, headers } = contextFor(decorated);
    const error = await guard.canActivate(context).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(headers).toEqual({
      'RateLimit-Policy': '"public";q=2;w=60',
      RateLimit: '"public";r=0;t=55',
      'Retry-After': '55',
    });
  });

  it('fails open and warns, without the IP, when the counter store is down', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const store: CounterStore = {
      incrementWithWindow: () => Promise.reject(new Error('redis down')),
      reset: async () => {},
    };
    const { context, headers } = contextFor(decorated);
    await expect(guardWith(store).canActivate(context)).resolves.toBe(true);
    expect(headers).toEqual({});
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).not.toContain('203.0.113.7');
  });
});

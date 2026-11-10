import { LoginRateLimiter, type CounterStore } from './login-rate-limiter.js';

/** In-memory stand-in for the two Redis commands the limiter uses. */
class FakeStore implements CounterStore {
  readonly counts = new Map<string, number>();
  readonly ttls = new Map<string, number>();
  async incrementWithWindow(
    key: string,
    windowSeconds: number,
  ): Promise<{ count: number; ttl: number }> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    if (!this.ttls.has(key)) this.ttls.set(key, windowSeconds);
    return { count, ttl: this.ttls.get(key)! };
  }
  async reset(key: string): Promise<void> {
    this.counts.delete(key);
    this.ttls.delete(key);
  }
}

describe('LoginRateLimiter (CORE-02, §8 rate limits)', () => {
  const limits = { perEmail: 3, perIp: 5, windowSeconds: 900 };

  it('allows attempts up to the per-email limit, then asks to retry after the window', async () => {
    const limiter = new LoginRateLimiter(new FakeStore(), limits);
    for (let i = 0; i < 3; i++)
      expect(await limiter.hit('1.2.3.4', 'ana@demo.test')).toEqual({
        allowed: true,
      });
    expect(await limiter.hit('1.2.3.4', 'ana@demo.test')).toEqual({
      allowed: false,
      retryAfterSeconds: 900,
    });
  });

  it('counts the email case-insensitively and never stores it in clear', async () => {
    const store = new FakeStore();
    const limiter = new LoginRateLimiter(store, limits);
    await limiter.hit('1.1.1.1', 'Ana@Demo.test');
    await limiter.hit('2.2.2.2', 'ana@demo.test');
    const keys = [...store.counts.keys()];
    expect(keys.some((k) => k.includes('ana') || k.includes('demo'))).toBe(
      false,
    );
    expect(Math.max(...store.counts.values())).toBe(2); // same email bucket
  });

  it('limits one IP trying many emails', async () => {
    const limiter = new LoginRateLimiter(new FakeStore(), limits);
    for (let i = 0; i < 5; i++)
      await limiter.hit('9.9.9.9', `user${i}@demo.test`);
    expect((await limiter.hit('9.9.9.9', 'other@demo.test')).allowed).toBe(
      false,
    );
  });

  it('clears the email bucket after a successful login', async () => {
    const limiter = new LoginRateLimiter(new FakeStore(), limits);
    for (let i = 0; i < 3; i++) await limiter.hit('1.2.3.4', 'ana@demo.test');
    await limiter.succeeded('ana@demo.test');
    expect((await limiter.hit('1.2.3.4', 'ana@demo.test')).allowed).toBe(true);
  });
});

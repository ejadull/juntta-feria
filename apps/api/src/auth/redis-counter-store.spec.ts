import type { AppConfiguration } from '../config/configuration.js';

/** Mimics ioredis with lazyConnect + enableOfflineQueue: false: commands fail until 'ready'. */
const fake = vi.hoisted(() => ({
  Redis: class {
    status = 'wait';
    connect = vi.fn(() => {
      this.status = 'connecting';
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          this.status = 'ready';
          resolve();
        }, 5),
      );
    });
    on() {}
    disconnect() {}
    multi() {
      const ready = this.status === 'ready';
      const chain = {
        incr: () => chain,
        expire: () => chain,
        ttl: () => chain,
        exec: async () => {
          if (!ready) throw new Error("Stream isn't writeable");
          return [
            [null, 1],
            [null, 1],
            [null, 60],
          ];
        },
      };
      return chain;
    }
  },
}));
vi.mock('ioredis', () => ({ Redis: fake.Redis }));

const { RedisCounterStore } = await import('./redis-counter-store.js');

describe('RedisCounterStore', () => {
  it('lets concurrent first calls share one connection instead of failing (cold start 503)', async () => {
    const store = new RedisCounterStore({
      redisUrl: 'redis://x',
    } as AppConfiguration);

    const results = await Promise.all([
      store.incrementWithWindow('a', 60),
      store.incrementWithWindow('b', 60),
    ]);

    expect(results).toEqual([
      { count: 1, ttl: 60 },
      { count: 1, ttl: 60 },
    ]);
  });
});

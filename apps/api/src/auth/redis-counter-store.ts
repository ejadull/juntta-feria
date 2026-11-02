import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { configuration, type AppConfiguration } from '../config/configuration.js';
import type { CounterStore } from './login-rate-limiter.js';

/** Fixed-window counters in Redis: INCR + EXPIRE NX (window starts on the first hit) + TTL. */
@Injectable()
export class RedisCounterStore implements CounterStore, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(@Inject(configuration.KEY) env: AppConfiguration) {
    this.redis = new Redis(env.redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false, // fail fast: login answers 503 instead of hanging
      maxRetriesPerRequest: 1,
    });
    this.redis.on('error', () => {}); // surfaced through the failing command
  }

  async incrementWithWindow(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
    await this.connect();
    const results = await this.redis.multi().incr(key).expire(key, windowSeconds, 'NX').ttl(key).exec();
    if (!results || results.some(([error]) => error)) throw new Error('Rate limit store failed.');
    return { count: Number(results[0][1]), ttl: Number(results[2][1]) };
  }

  async reset(key: string): Promise<void> {
    await this.connect();
    await this.redis.del(key);
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  private async connect(): Promise<void> {
    if (this.redis.status === 'wait' || this.redis.status === 'end') await this.redis.connect();
  }
}

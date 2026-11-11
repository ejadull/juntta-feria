import { Module } from '@nestjs/common';
import { RedisCounterStore } from '../auth/redis-counter-store.js';
import { RateLimitGuard } from './rate-limit.guard.js';

/** The one Redis counter store (login limiter and public rate limit share its connection). */
@Module({
  providers: [RedisCounterStore, RateLimitGuard],
  exports: [RedisCounterStore, RateLimitGuard],
})
export class RateLimitModule {}

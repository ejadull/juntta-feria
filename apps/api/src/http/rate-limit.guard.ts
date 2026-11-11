import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CounterStore } from '../auth/login-rate-limiter.js';
import { RedisCounterStore } from '../auth/redis-counter-store.js';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { rateLimitHeaders, secondsToReset } from './rate-limit-headers.js';

export const RATE_LIMIT_KEY = 'rateLimit:bucket';

/** Buckets configured in the environment (PUBLIC_RATE_LIMIT*, WEBHOOK_RATE_LIMIT). */
export type RateLimitBucket = keyof AppConfiguration['rateLimits'];

/**
 * Per-client-IP fixed-window limit for an anonymous route or controller; pair it with
 * `@UseGuards(RateLimitGuard)` (the module must import RateLimitModule).
 */
export const RateLimit = (bucket: RateLimitBucket) =>
  SetMetadata(RATE_LIMIT_KEY, bucket);

/**
 * Over the limit: 429 Too Many Requests (RFC 6585) rendered by the problem filter as RFC 9457
 * `application/problem+json` with code RATE_LIMITED, plus `Retry-After` (RFC 9110 §10.2.3).
 * Every answer of a limited route carries `RateLimit-Policy` / `RateLimit`
 * (draft-ietf-httpapi-ratelimit-headers-11).
 *
 * Built on the CounterStore of the login limiter (Redis INCR + EXPIRE NX), so a window is shared
 * by every API instance. If the store fails the guard FAILS OPEN (public reads keep working, a
 * warning is logged): an outage of the limiter must not take the public portal down. The login
 * limiter keeps its own, fail-closed behaviour.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(RedisCounterStore) private readonly store: CounterStore,
    @Inject(configuration.KEY) private readonly env: AppConfiguration,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bucket = this.reflector.getAllAndOverride<
      RateLimitBucket | undefined
    >(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!bucket) return true;
    const { limit, windowSeconds } = this.env.rateLimits[bucket];
    const http = context.switchToHttp();
    const { ip } = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    let usage: { count: number; ttl: number };
    try {
      usage = await this.store.incrementWithWindow(
        `ratelimit:${bucket}:${ip}`,
        windowSeconds,
      );
    } catch (error) {
      // No IP and no key in the log: only that the limiter is degraded.
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `Rate limit store unavailable, allowing "${bucket}" requests: ${reason}`,
      );
      return true;
    }

    const policy = { name: bucket, limit, windowSeconds };
    for (const [name, value] of Object.entries(rateLimitHeaders(policy, usage)))
      void reply.header(name, value);
    if (usage.count <= limit) return true;
    void reply.header('Retry-After', String(secondsToReset(policy, usage)));
    throw new HttpException(
      { message: 'Too many requests. Try again later.', code: 'RATE_LIMITED' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

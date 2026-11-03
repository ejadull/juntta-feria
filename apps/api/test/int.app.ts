import { Test } from '@nestjs/testing';
import type { Type } from '@nestjs/common';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';
import type { CounterStore } from '../src/auth/login-rate-limiter.js';
import { RedisCounterStore } from '../src/auth/redis-counter-store.js';
import { configureApp, fastifyOptions } from '../src/bootstrap.js';
import { READINESS_CHECKS } from '../src/health/readiness.js';
import { appTestUrl } from './int.env.js';

export const ORIGIN = 'http://localhost:4200';
export const COOKIE = 'juntta_rt';

/** Map-backed counters: the throttling logic is real, only Redis is replaced. */
class MemoryCounterStore implements CounterStore {
  private readonly counts = new Map<string, number>();
  async incrementWithWindow(key: string, windowSeconds: number) {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { count, ttl: windowSeconds };
  }
  async reset(key: string) {
    this.counts.delete(key);
  }
}

/**
 * The real app (bootstrap, guards, DatabaseModule) connected as juntta_app to the `<db>_test`
 * database. Redis and S3 are never reached; their variables only satisfy the env schema.
 */
export async function startIntApp(
  controllers: Type[] = [],
): Promise<NestFastifyApplication> {
  const env = {
    NODE_ENV: 'test',
    API_PREFIX: 'api/v1',
    CORS_ORIGINS: ORIGIN,
    DATABASE_URL: appTestUrl(),
    REDIS_URL: 'redis://127.0.0.1:1',
    S3_ENDPOINT: 'http://127.0.0.1:1',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'test-bucket',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    SWAGGER_ENABLED: 'false',
    AUTH_ACCESS_TOKEN_SECRET: 'int-access-secret-0123456789abcdef0123456789',
    AUTH_REFRESH_TOKEN_SECRET: 'int-refresh-secret-0123456789abcdef012345678',
    AUTH_REFRESH_COOKIE_NAME: COOKIE,
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers,
  })
    .overrideProvider(READINESS_CHECKS)
    .useValue([])
    .overrideProvider(RedisCounterStore)
    .useValue(new MemoryCounterStore())
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(fastifyOptions()),
  );
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import pg from 'pg';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import type { ReadinessCheck } from './readiness.js';

/** Per-check budget; readiness answers within this even if a dependency hangs. */
export const CHECK_TIMEOUT_MS = 2000;

// ponytail: each check owns a tiny client until CORE-01 adds the shared pool (Drizzle);
// then PostgresCheck should reuse that pool instead of opening its own.
@Injectable()
export class PostgresCheck implements ReadinessCheck, OnModuleDestroy {
  readonly name = 'postgres';
  private readonly pool: pg.Pool;

  constructor(@Inject(configuration.KEY) env: AppConfiguration) {
    this.pool = new pg.Pool({
      connectionString: env.databaseUrl,
      max: 1,
      connectionTimeoutMillis: CHECK_TIMEOUT_MS,
    });
    // Idle-client errors would otherwise crash the process; the next check reports them.
    this.pool.on('error', (e) =>
      new Logger('Readiness').warn(`postgres idle client: ${e.message}`),
    );
  }

  async check(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

@Injectable()
export class RedisCheck implements ReadinessCheck, OnModuleDestroy {
  readonly name = 'redis';
  private readonly redis: Redis;

  constructor(@Inject(configuration.KEY) env: AppConfiguration) {
    this.redis = new Redis(env.redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: CHECK_TIMEOUT_MS,
    });
    this.redis.on('error', () => {}); // reported by check(); avoids unhandled 'error' events
  }

  async check(): Promise<void> {
    if (this.redis.status === 'wait' || this.redis.status === 'end')
      await this.redis.connect();
    await this.redis.ping();
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}

/** Object storage: HeadBucket proves endpoint, credentials and bucket at once. */
@Injectable()
export class StorageCheck implements ReadinessCheck, OnModuleDestroy {
  readonly name = 'storage';
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(@Inject(configuration.KEY) env: AppConfiguration) {
    this.bucket = env.s3.bucket;
    this.s3 = new S3Client({
      region: env.s3.region,
      endpoint: env.s3.endpoint,
      forcePathStyle: env.s3.forcePathStyle,
      credentials: {
        accessKeyId: env.s3.accessKey,
        secretAccessKey: env.s3.secretKey,
      },
      maxAttempts: 1,
    });
  }

  async check(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  onModuleDestroy(): void {
    this.s3.destroy();
  }
}

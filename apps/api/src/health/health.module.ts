import { Module } from '@nestjs/common';
import { PostgresCheck, RedisCheck, StorageCheck } from './checks.js';
import { HealthController } from './health.controller.js';
import { READINESS_CHECKS, type ReadinessCheck } from './readiness.js';

@Module({
  controllers: [HealthController],
  providers: [
    PostgresCheck,
    RedisCheck,
    StorageCheck,
    {
      provide: READINESS_CHECKS,
      useFactory: (...checks: ReadinessCheck[]) => checks,
      inject: [PostgresCheck, RedisCheck, StorageCheck],
    },
  ],
})
export class HealthModule {}

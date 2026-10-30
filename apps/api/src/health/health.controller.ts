import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CHECK_TIMEOUT_MS } from './checks.js';
import {
  READINESS_CHECKS,
  runChecks,
  type ReadinessCheck,
  type ReadinessResult,
} from './readiness.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(READINESS_CHECKS)
    private readonly checks: readonly ReadinessCheck[],
  ) {}

  /** Liveness: the process answers. Never touches external services, so it cannot cascade. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: PostgreSQL, Redis and the storage bucket answer; 503 otherwise. */
  @Get('ready')
  async ready(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReadinessResult> {
    const result = await runChecks(this.checks, CHECK_TIMEOUT_MS);
    if (result.status !== 'ok')
      void reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}

import { Logger } from '@nestjs/common';

/** A dependency the API needs to serve traffic. Throws (or never settles) when unavailable. */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}

/** DI token for the list of readiness checks (overridden with fakes in tests). */
export const READINESS_CHECKS = Symbol('READINESS_CHECKS');

export interface ReadinessResult {
  readonly status: 'ok' | 'error';
  readonly checks: Readonly<Record<string, 'up' | 'down'>>;
}

const logger = new Logger('Readiness');

function withTimeout(run: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}

/** Runs every check in parallel; failures are logged server-side and reported only as "down". */
export async function runChecks(
  checks: readonly ReadinessCheck[],
  timeoutMs: number,
): Promise<ReadinessResult> {
  const settled = await Promise.allSettled(
    checks.map((c) =>
      withTimeout(
        Promise.resolve().then(() => c.check()),
        timeoutMs,
      ),
    ),
  );
  const entries = settled.map((result, i) => {
    const name = checks[i].name;
    if (result.status === 'rejected') {
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      logger.warn(`${name} is down: ${reason}`);
    }
    return [name, result.status === 'fulfilled' ? 'up' : 'down'] as const;
  });
  return {
    status: entries.every(([, state]) => state === 'up') ? 'ok' : 'error',
    checks: Object.fromEntries(entries),
  };
}

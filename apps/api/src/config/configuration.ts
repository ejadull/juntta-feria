import { registerAs, type ConfigType } from '@nestjs/config';
import { parseEnvironment } from './env.schema.js';

/**
 * Validated configuration under the `app` namespace. The factory runs at bootstrap, so an
 * invalid environment stops the API before it listens (ADR 0004).
 * Inject with `@Inject(configuration.KEY) config: AppConfiguration`.
 */
export const configuration = registerAs('app', () =>
  parseEnvironment(process.env),
);

export type AppConfiguration = ConfigType<typeof configuration>;

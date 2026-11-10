import { z } from 'zod';

/**
 * Environment contract (ADR 0004, FND-02). Parsed once at startup.
 * Errors name the variable and the rule, never the received value (AGENT.md §5/§6).
 * Reserved variables (RESERVATION_*) are ignored until their task consumes them.
 */

const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
] as const;
const NODE_ENVS = ['development', 'test', 'production'] as const;
const MP_ENVIRONMENTS = ['sandbox', 'production'] as const;

export type AppEnvironment = Readonly<{
  nodeEnv: (typeof NODE_ENVS)[number];
  apiHost: string;
  port: number;
  apiPrefix: string;
  corsOrigins: readonly string[];
  logLevel: (typeof LOG_LEVELS)[number];
  databaseUrl: string;
  dbPoolMax: number;
  redisUrl: string;
  s3: Readonly<{
    /** Undefined means the provider's default endpoint (real AWS S3). */
    endpoint: string | undefined;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    forcePathStyle: boolean;
  }>;
  swaggerEnabled: boolean;
  /** CORE-02 (ADR 0004): short JWT access token + opaque rotating refresh token cookie. */
  auth: Readonly<{
    accessTokenSecret: string;
    refreshTokenSecret: string;
    accessTokenTtlSeconds: number;
    refreshTokenTtlSeconds: number;
    refreshCookieName: string;
    cookieSecure: boolean;
    cookieSameSite: 'strict' | 'lax';
  }>;
  /** PAY-01 (ADR 0006). Credentials may be empty: payments then fail with 503, the API still runs (§13.1). */
  mercadoPago: Readonly<{
    environment: (typeof MP_ENVIRONMENTS)[number];
    accessToken: string | undefined;
    webhookSecret: string | undefined;
    /** Public HTTPS webhook URL; when unset, the one configured in the Mercado Pago panel applies. */
    notificationUrl: string | undefined;
    /** PAY-07 OAuth app (ADR 0006 §2): each organizer links its own seller account. */
    clientId: string | undefined;
    clientSecret: string | undefined;
    oauthRedirectUri: string | undefined;
    /** Base64 of 32 bytes: AES-256-GCM key for the sellers' tokens. */
    tokenKey: string | undefined;
  }>;
}>;

const MIN_SECRET_LENGTH = 32;

export class EnvironmentError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'EnvironmentError';
  }
}

/** '' behaves like "not set", so optional variables fall back to their default. */
const blankAsUndefined = (v: unknown) => (v === '' ? undefined : v);

const required = z
  .string({ error: 'is required' })
  .trim()
  .min(1, { error: 'is required' });

const optionalInt = (min: number, max: number, fallback: number) =>
  z.preprocess(
    (v) => (blankAsUndefined(v) === undefined ? undefined : Number(v)),
    z
      .number({ error: 'must be a number' })
      .int({ error: 'must be an integer' })
      .min(min, { error: `must be >= ${min}` })
      .max(max, { error: `must be <= ${max}` })
      .default(fallback),
  );

const optionalBool = (fallback: boolean) =>
  z.preprocess(
    blankAsUndefined,
    z
      .enum(['true', 'false', '1', '0'], {
        error: 'must be true, false, 1 or 0',
      })
      .default(fallback ? 'true' : 'false')
      .transform((v) => v === 'true' || v === '1'),
  );

function hasProtocol(value: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const secret = required.refine((v) => v.length >= MIN_SECRET_LENGTH, {
  error: `must be at least ${MIN_SECRET_LENGTH} characters`,
});

const urlWith = (protocols: readonly string[]) =>
  required.refine((v) => hasProtocol(v, protocols), {
    error: `must be a URL using ${protocols.join(' or ')}`,
  });

const corsOrigins = required.transform((value, ctx) => {
  const origins = value.split(',').map((o) => o.trim());
  if (origins.some((o) => o === '')) {
    ctx.addIssue({ code: 'custom', message: 'must not contain empty entries' });
    return z.NEVER;
  }
  if (origins.includes('*')) {
    if (origins.length > 1)
      ctx.addIssue({
        code: 'custom',
        message: "'*' cannot be combined with origins",
      });
    return origins;
  }
  if (!origins.every((o) => hasProtocol(o, ['http:', 'https:']))) {
    ctx.addIssue({
      code: 'custom',
      message: 'each origin must be an http(s) URL',
    });
    return z.NEVER;
  }
  return origins;
});

const schema = z
  .object({
    NODE_ENV: z.preprocess(
      blankAsUndefined,
      z
        .enum(NODE_ENVS, { error: `must be one of ${NODE_ENVS.join(', ')}` })
        .default('development'),
    ),
    API_HOST: z.preprocess(
      blankAsUndefined,
      z.string().trim().min(1).default('0.0.0.0'),
    ),
    PORT: optionalInt(1, 65535, 3000),
    API_PREFIX: z.preprocess(
      blankAsUndefined,
      z
        .string()
        .default('api/v1')
        .transform((v) => v.trim().replace(/^\/+|\/+$/g, ''))
        .refine((v) => v.length > 0, { error: 'must not be empty' }),
    ),
    CORS_ORIGINS: corsOrigins,
    LOG_LEVEL: z.preprocess(
      blankAsUndefined,
      z
        .enum(LOG_LEVELS, { error: `must be one of ${LOG_LEVELS.join(', ')}` })
        .default('info'),
    ),
    DATABASE_URL: urlWith(['postgres:', 'postgresql:']),
    DB_POOL_MAX: optionalInt(1, 1000, 10),
    REDIS_URL: urlWith(['redis:', 'rediss:']),
    S3_ENDPOINT: z.preprocess(
      blankAsUndefined,
      z
        .string()
        .refine((v) => hasProtocol(v, ['http:', 'https:']), {
          error: 'must be an http(s) URL',
        })
        .optional(),
    ),
    S3_REGION: required,
    S3_BUCKET: required,
    S3_ACCESS_KEY: required,
    S3_SECRET_KEY: required,
    S3_FORCE_PATH_STYLE: optionalBool(false),
    SWAGGER_ENABLED: optionalBool(false),
    AUTH_ACCESS_TOKEN_SECRET: secret,
    AUTH_REFRESH_TOKEN_SECRET: secret,
    AUTH_ACCESS_TOKEN_TTL_SECONDS: optionalInt(60, 3600, 900),
    AUTH_REFRESH_TOKEN_TTL_SECONDS: optionalInt(3600, 7_776_000, 1_209_600),
    AUTH_REFRESH_COOKIE_NAME: z.preprocess(
      blankAsUndefined,
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,64}$/, {
          error: 'must be 1-64 letters, digits, _ or -',
        })
        .default('juntta_rt'),
    ),
    AUTH_COOKIE_SECURE: optionalBool(true),
    AUTH_COOKIE_SAME_SITE: z.preprocess(
      blankAsUndefined,
      z
        .enum(['strict', 'lax'], { error: 'must be strict or lax' })
        .default('strict'),
    ),
    MP_ENVIRONMENT: z.preprocess(
      blankAsUndefined,
      z
        .enum(MP_ENVIRONMENTS, {
          error: `must be one of ${MP_ENVIRONMENTS.join(', ')}`,
        })
        .default('sandbox'),
    ),
    MP_ACCESS_TOKEN: z.preprocess(
      blankAsUndefined,
      z.string().trim().optional(),
    ),
    MP_WEBHOOK_SECRET: z.preprocess(
      blankAsUndefined,
      z.string().trim().optional(),
    ),
    MP_NOTIFICATION_URL: z.preprocess(
      blankAsUndefined,
      z
        .string()
        .refine((v) => hasProtocol(v, ['https:']), {
          error: 'must be an https URL',
        })
        .optional(),
    ),
    MP_CLIENT_ID: z.preprocess(blankAsUndefined, z.string().trim().optional()),
    MP_CLIENT_SECRET: z.preprocess(
      blankAsUndefined,
      z.string().trim().optional(),
    ),
    MP_OAUTH_REDIRECT_URI: z.preprocess(
      blankAsUndefined,
      z
        .string()
        .refine((v) => hasProtocol(v, ['https:', 'http:']), {
          error: 'must be an http(s) URL',
        })
        .optional(),
    ),
    MP_TOKEN_ENCRYPTION_KEY: z.preprocess(
      blankAsUndefined,
      z
        .string()
        .refine((v) => Buffer.from(v, 'base64').length === 32, {
          error: 'must be 32 bytes in base64',
        })
        .optional(),
    ),
  })
  .superRefine((env, ctx) => {
    if (env.MP_CLIENT_ID)
      for (const key of [
        'MP_CLIENT_SECRET',
        'MP_OAUTH_REDIRECT_URI',
        'MP_TOKEN_ENCRYPTION_KEY',
      ] as const)
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'is required with MP_CLIENT_ID',
          });
    if (env.AUTH_ACCESS_TOKEN_SECRET === env.AUTH_REFRESH_TOKEN_SECRET)
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_REFRESH_TOKEN_SECRET'],
        message: 'must differ from AUTH_ACCESS_TOKEN_SECRET',
      });
    if (env.NODE_ENV !== 'production') return;
    if (!env.AUTH_COOKIE_SECURE)
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SECURE'],
        message: 'must be true in production',
      });
    if (env.CORS_ORIGINS.includes('*'))
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: "'*' is not allowed in production",
      });
    if (env.SWAGGER_ENABLED)
      ctx.addIssue({
        code: 'custom',
        path: ['SWAGGER_ENABLED'],
        message: 'must be false in production',
      });
  });

export function parseEnvironment(input: NodeJS.ProcessEnv): AppEnvironment {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Only the variable name and the rule: issue messages above never interpolate the input.
    const problems = result.error.issues.map(
      (i) => `${String(i.path[0] ?? 'environment')}: ${i.message}`,
    );
    throw new EnvironmentError([...new Set(problems)]);
  }
  const e = result.data;
  return {
    nodeEnv: e.NODE_ENV,
    apiHost: e.API_HOST,
    port: e.PORT,
    apiPrefix: e.API_PREFIX,
    corsOrigins: e.CORS_ORIGINS,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    dbPoolMax: e.DB_POOL_MAX,
    redisUrl: e.REDIS_URL,
    s3: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKey: e.S3_ACCESS_KEY,
      secretKey: e.S3_SECRET_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
    },
    swaggerEnabled: e.SWAGGER_ENABLED,
    auth: {
      accessTokenSecret: e.AUTH_ACCESS_TOKEN_SECRET,
      refreshTokenSecret: e.AUTH_REFRESH_TOKEN_SECRET,
      accessTokenTtlSeconds: e.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: e.AUTH_REFRESH_TOKEN_TTL_SECONDS,
      refreshCookieName: e.AUTH_REFRESH_COOKIE_NAME,
      cookieSecure: e.AUTH_COOKIE_SECURE,
      cookieSameSite: e.AUTH_COOKIE_SAME_SITE,
    },
    mercadoPago: {
      environment: e.MP_ENVIRONMENT,
      accessToken: e.MP_ACCESS_TOKEN,
      webhookSecret: e.MP_WEBHOOK_SECRET,
      notificationUrl: e.MP_NOTIFICATION_URL,
      clientId: e.MP_CLIENT_ID,
      clientSecret: e.MP_CLIENT_SECRET,
      oauthRedirectUri: e.MP_OAUTH_REDIRECT_URI,
      tokenKey: e.MP_TOKEN_ENCRYPTION_KEY,
    },
  };
}

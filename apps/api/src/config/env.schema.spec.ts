import { parseEnvironment } from './env.schema.js';

/** Fictitious values only: nothing here is a usable credential. */
const SECRET = 'fake-secret-value-0123456789abcdef';
const ACCESS_SECRET = 'fake-access-secret-0123456789abcdef0123456789';
const REFRESH_SECRET = 'fake-refresh-secret-0123456789abcdef012345678';
const valid = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  API_HOST: '0.0.0.0',
  PORT: '3000',
  API_PREFIX: '/api/v1/',
  CORS_ORIGINS: 'http://localhost:4200, http://127.0.0.1:4200',
  LOG_LEVEL: 'debug',
  DATABASE_URL: `postgresql://app:${SECRET}@localhost:5432/app`,
  DB_POOL_MAX: '5',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:4566',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'local-bucket',
  S3_ACCESS_KEY: 'test',
  S3_SECRET_KEY: SECRET,
  S3_FORCE_PATH_STYLE: 'true',
  SWAGGER_ENABLED: 'true',
  AUTH_ACCESS_TOKEN_SECRET: ACCESS_SECRET,
  AUTH_REFRESH_TOKEN_SECRET: REFRESH_SECRET,
});

/** Runs the parser expecting a failure; returns the error message. */
function failure(env: NodeJS.ProcessEnv): string {
  try {
    parseEnvironment(env);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected parseEnvironment to throw');
}

describe('parseEnvironment (FND-02)', () => {
  it('parses a complete local environment into typed values', () => {
    expect(parseEnvironment(valid())).toEqual({
      nodeEnv: 'development',
      apiHost: '0.0.0.0',
      port: 3000,
      apiPrefix: 'api/v1',
      corsOrigins: ['http://localhost:4200', 'http://127.0.0.1:4200'],
      logLevel: 'debug',
      databaseUrl: `postgresql://app:${SECRET}@localhost:5432/app`,
      dbPoolMax: 5,
      redisUrl: 'redis://localhost:6379',
      s3: {
        endpoint: 'http://localhost:4566',
        region: 'us-east-1',
        bucket: 'local-bucket',
        accessKey: 'test',
        secretKey: SECRET,
        forcePathStyle: true,
      },
      swaggerEnabled: true,
      auth: {
        accessTokenSecret: ACCESS_SECRET,
        refreshTokenSecret: REFRESH_SECRET,
        accessTokenTtlSeconds: 900,
        refreshTokenTtlSeconds: 1_209_600,
        refreshCookieName: 'juntta_rt',
        cookieSecure: true,
        cookieSameSite: 'strict',
        passwordEnabled: false,
      },
      mercadoPago: {
        environment: 'sandbox',
        accessToken: undefined,
        webhookSecret: undefined,
        notificationUrl: undefined,
        clientId: undefined,
        clientSecret: undefined,
        oauthRedirectUri: undefined,
        tokenKey: undefined,
        publicKey: undefined,
        checkoutApi: 'preferences',
      },
      google: { clientId: undefined },
    });
  });

  it('reads the optional Google client id (CORE-05)', () => {
    expect(
      parseEnvironment({
        ...valid(),
        GOOGLE_CLIENT_ID: ' 123-abc.apps.googleusercontent.com ',
      }).google.clientId,
    ).toBe('123-abc.apps.googleusercontent.com');
    expect(
      parseEnvironment({ ...valid(), GOOGLE_CLIENT_ID: '' }).google.clientId,
    ).toBeUndefined();
  });

  it('keeps password sign-in off unless AUTH_PASSWORD_ENABLED is true (CORE-05)', () => {
    expect(
      parseEnvironment({ ...valid(), AUTH_PASSWORD_ENABLED: 'true' }).auth
        .passwordEnabled,
    ).toBe(true);
    expect(
      parseEnvironment({ ...valid(), AUTH_PASSWORD_ENABLED: '' }).auth
        .passwordEnabled,
    ).toBe(false);
    expect(() =>
      parseEnvironment({ ...valid(), AUTH_PASSWORD_ENABLED: 'maybe' }),
    ).toThrow(/AUTH_PASSWORD_ENABLED/);
  });

  it('reads the Mercado Pago settings (PAY-01)', () => {
    const env = parseEnvironment({
      ...valid(),
      MP_ENVIRONMENT: 'production',
      MP_ACCESS_TOKEN: 'fake-mp-token',
      MP_PUBLIC_KEY: 'APP_USR-fake-public-key',
      MP_WEBHOOK_SECRET: 'fake-mp-webhook-secret',
      MP_NOTIFICATION_URL:
        'https://api.example.test/api/v1/webhooks/mercadopago',
    });
    expect(env.mercadoPago).toEqual({
      environment: 'production',
      accessToken: 'fake-mp-token',
      webhookSecret: 'fake-mp-webhook-secret',
      notificationUrl: 'https://api.example.test/api/v1/webhooks/mercadopago',
      clientId: undefined,
      clientSecret: undefined,
      oauthRedirectUri: undefined,
      tokenKey: undefined,
      publicKey: 'APP_USR-fake-public-key',
      checkoutApi: 'preferences',
    });
  });

  it('selects the Checkout Pro API with MP_CHECKOUT_API (preferences by default)', () => {
    expect(
      parseEnvironment({ ...valid(), MP_CHECKOUT_API: 'orders' }).mercadoPago
        .checkoutApi,
    ).toBe('orders');
    expect(
      parseEnvironment({ ...valid(), MP_CHECKOUT_API: '' }).mercadoPago
        .checkoutApi,
    ).toBe('preferences');
    expect(() =>
      parseEnvironment({ ...valid(), MP_CHECKOUT_API: 'checkout' }),
    ).toThrow(/MP_CHECKOUT_API/);
  });

  it('reads the platform subscription price (EXH-05) and rejects a non-positive one', () => {
    expect(
      parseEnvironment({
        ...valid(),
        PLATFORM_SUBSCRIPTION_PRICE_CENTS: '1500000',
      }).mercadoPago.subscriptionPriceCents,
    ).toBe(1_500_000);
    expect(
      parseEnvironment({ ...valid(), PLATFORM_SUBSCRIPTION_PRICE_CENTS: '' })
        .mercadoPago.subscriptionPriceCents,
    ).toBeUndefined();
    for (const bad of ['0', '-5', '12.5', 'abc'])
      expect(() =>
        parseEnvironment({
          ...valid(),
          PLATFORM_SUBSCRIPTION_PRICE_CENTS: bad,
        }),
      ).toThrow(/PLATFORM_SUBSCRIPTION_PRICE_CENTS/);
  });

  const OAUTH = {
    MP_CLIENT_ID: '1234567890',
    MP_CLIENT_SECRET: 'fake-client-secret',
    MP_OAUTH_REDIRECT_URI:
      'https://app.example.test/organizador/mercado-pago/vincular',
    MP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  };

  it('reads the OAuth app and the token key (PAY-07)', () => {
    const env = parseEnvironment({ ...valid(), ...OAUTH });
    expect(env.mercadoPago).toMatchObject({
      clientId: '1234567890',
      clientSecret: 'fake-client-secret',
      oauthRedirectUri: OAUTH.MP_OAUTH_REDIRECT_URI,
      tokenKey: OAUTH.MP_TOKEN_ENCRYPTION_KEY,
    });
  });

  it.each([
    'MP_CLIENT_SECRET',
    'MP_OAUTH_REDIRECT_URI',
    'MP_TOKEN_ENCRYPTION_KEY',
  ])('requires %s when MP_CLIENT_ID is set', (key) => {
    expect(failure({ ...valid(), ...OAUTH, [key]: '' })).toContain(key);
  });

  it('rejects a token key that is not 32 bytes of base64', () => {
    const short = Buffer.alloc(16, 7).toString('base64');
    expect(
      failure({ ...valid(), ...OAUTH, MP_TOKEN_ENCRYPTION_KEY: short }),
    ).toContain('MP_TOKEN_ENCRYPTION_KEY');
  });

  it.each([
    ['MP_ENVIRONMENT', 'live'],
    ['MP_NOTIFICATION_URL', 'http://api.example.test/hook'],
  ])('rejects an invalid %s', (key, value) => {
    expect(failure({ ...valid(), [key]: value })).toContain(key);
  });

  it('reads the auth settings (CORE-02, ADR 0004)', () => {
    const env = parseEnvironment({
      ...valid(),
      AUTH_ACCESS_TOKEN_TTL_SECONDS: '300',
      AUTH_REFRESH_TOKEN_TTL_SECONDS: '86400',
      AUTH_REFRESH_COOKIE_NAME: 'rt',
      AUTH_COOKIE_SECURE: 'false',
      AUTH_COOKIE_SAME_SITE: 'lax',
    });
    expect(env.auth).toMatchObject({
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 86_400,
      refreshCookieName: 'rt',
      cookieSecure: false,
      cookieSameSite: 'lax',
    });
  });

  it('rejects identical access and refresh secrets', () => {
    expect(
      failure({ ...valid(), AUTH_REFRESH_TOKEN_SECRET: ACCESS_SECRET }),
    ).toContain('AUTH_REFRESH_TOKEN_SECRET');
  });

  it('applies safe defaults for optional settings', () => {
    const input = valid();
    for (const key of [
      'NODE_ENV',
      'API_HOST',
      'PORT',
      'API_PREFIX',
      'LOG_LEVEL',
      'DB_POOL_MAX',
      'S3_ENDPOINT',
      'S3_FORCE_PATH_STYLE',
      'SWAGGER_ENABLED',
    ])
      delete input[key];
    const env = parseEnvironment(input);
    expect(env).toMatchObject({
      nodeEnv: 'development',
      apiHost: '0.0.0.0',
      port: 3000,
      apiPrefix: 'api/v1',
      logLevel: 'info',
      dbPoolMax: 10,
      swaggerEnabled: false,
    });
    expect(env.s3.endpoint).toBeUndefined();
    expect(env.s3.forcePathStyle).toBe(false);
  });

  it.each([
    'DATABASE_URL',
    'REDIS_URL',
    'CORS_ORIGINS',
    'S3_REGION',
    'S3_BUCKET',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'AUTH_ACCESS_TOKEN_SECRET',
    'AUTH_REFRESH_TOKEN_SECRET',
  ])('fails naming %s when it is missing', (key) => {
    const input = valid();
    delete input[key];
    expect(failure(input)).toContain(key);
  });

  it('never echoes received values in the error', () => {
    const message = failure({
      ...valid(),
      DATABASE_URL: `not-a-url-${SECRET}`,
      S3_SECRET_KEY: '',
    });
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('S3_SECRET_KEY');
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain('not-a-url');
  });

  it.each([
    ['DATABASE_URL', 'mysql://host/db'],
    ['REDIS_URL', 'http://localhost:6379'],
    ['S3_ENDPOINT', 'not a url'],
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', '30.5'],
    ['DB_POOL_MAX', '0'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'verbose'],
    ['SWAGGER_ENABLED', 'yes'],
    ['CORS_ORIGINS', 'http://localhost:4200,,http://x.test'],
    ['CORS_ORIGINS', 'localhost:4200'],
    ['AUTH_ACCESS_TOKEN_SECRET', 'too-short'],
    ['AUTH_ACCESS_TOKEN_TTL_SECONDS', '30'],
    ['AUTH_ACCESS_TOKEN_TTL_SECONDS', '3601'],
    ['AUTH_REFRESH_TOKEN_TTL_SECONDS', '3599'],
    ['AUTH_REFRESH_TOKEN_TTL_SECONDS', '7776001'],
    ['AUTH_REFRESH_COOKIE_NAME', 'bad name;'],
    ['AUTH_COOKIE_SECURE', 'maybe'],
    ['AUTH_COOKIE_SAME_SITE', 'none'],
  ])('rejects %s=%s', (key, value) => {
    expect(failure({ ...valid(), [key]: value })).toContain(key);
  });

  it('accepts a wildcard CORS origin outside production', () => {
    expect(
      parseEnvironment({ ...valid(), CORS_ORIGINS: '*' }).corsOrigins,
    ).toEqual(['*']);
  });

  describe('production policy', () => {
    const production = () => ({
      ...valid(),
      NODE_ENV: 'production',
      SWAGGER_ENABLED: 'false',
    });

    it('rejects a wildcard CORS origin', () => {
      expect(failure({ ...production(), CORS_ORIGINS: '*' })).toContain(
        'CORS_ORIGINS',
      );
    });

    it('rejects development Swagger', () => {
      expect(failure({ ...production(), SWAGGER_ENABLED: 'true' })).toContain(
        'SWAGGER_ENABLED',
      );
    });

    it('rejects a refresh cookie without Secure', () => {
      expect(
        failure({ ...production(), AUTH_COOKIE_SECURE: 'false' }),
      ).toContain('AUTH_COOKIE_SECURE');
    });

    it('accepts an explicit allowlist without Swagger', () => {
      expect(parseEnvironment(production()).nodeEnv).toBe('production');
    });
  });

  it('does not require reserved reservation or Mercado Pago variables', () => {
    expect(() =>
      parseEnvironment({
        ...valid(),
        MP_ACCESS_TOKEN: '',
        RESERVATION_HOLD_TTL_SECONDS: '',
      }),
    ).not.toThrow();
  });
});

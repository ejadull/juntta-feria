import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module.js';
import { configureApp, fastifyOptions } from '../src/bootstrap.js';
import {
  READINESS_CHECKS,
  type ReadinessCheck,
} from '../src/health/readiness.js';

/** FND-04: real bootstrap (prefix, CORS, correlation id, problem+json, health, OpenAPI) with fake dependencies. */

const ENV = {
  NODE_ENV: 'test',
  API_PREFIX: 'api/v1',
  CORS_ORIGINS: 'http://localhost:4200',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  REDIS_URL: 'redis://127.0.0.1:1',
  S3_ENDPOINT: 'http://127.0.0.1:1',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'test-bucket',
  S3_ACCESS_KEY: 'test',
  S3_SECRET_KEY: 'test',
  SWAGGER_ENABLED: 'false',
  AUTH_ACCESS_TOKEN_SECRET: 'fake-access-secret-0123456789abcdef0123456789',
  AUTH_REFRESH_TOKEN_SECRET: 'fake-refresh-secret-0123456789abcdef012345678',
};

const fake = (name: string, ok: boolean): ReadinessCheck => ({
  name,
  check: async () => {
    if (!ok) throw new Error(`${name} refused (secret-detail)`);
  },
});

async function start(
  checks: ReadinessCheck[],
  env: Partial<typeof ENV> = {},
): Promise<NestFastifyApplication> {
  for (const [key, value] of Object.entries({ ...ENV, ...env }))
    vi.stubEnv(key, value);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(READINESS_CHECKS)
    .useValue(checks)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(fastifyOptions()),
  );
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

const allUp = () => [
  fake('postgres', true),
  fake('redis', true),
  fake('storage', true),
];

describe('API base (FND-04)', () => {
  let app: NestFastifyApplication;

  afterEach(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('liveness answers under the versioned prefix even when every dependency is down', async () => {
    app = await start([
      fake('postgres', false),
      fake('redis', false),
      fake('storage', false),
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(
      (await app.inject({ method: 'GET', url: '/health/live' })).statusCode,
    ).toBe(404);
  });

  it('readiness is 200 when PostgreSQL, Redis and storage answer', async () => {
    app = await start(allUp());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health/ready',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      checks: { postgres: 'up', redis: 'up', storage: 'up' },
    });
  });

  it('readiness is 503 naming the failing dependency without leaking its error', async () => {
    app = await start([
      fake('postgres', true),
      fake('redis', false),
      fake('storage', true),
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health/ready',
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks).toEqual({
      postgres: 'up',
      redis: 'down',
      storage: 'up',
    });
    expect(res.payload).not.toContain('secret-detail');
  });

  it('echoes a safe correlation id and generates one otherwise', async () => {
    app = await start(allUp());
    const echoed = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
      headers: { 'x-correlation-id': 'client-req-0001' },
    });
    expect(echoed.headers['x-correlation-id']).toBe('client-req-0001');

    const unsafe = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
      headers: { 'x-correlation-id': 'bad id' },
    });
    expect(unsafe.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers unknown routes with application/problem+json and the correlation id', async () => {
    app = await start(allUp());
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/no-existe?token=abc',
      headers: { 'x-correlation-id': 'client-req-0002' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({
      status: 404,
      title: 'Not Found',
      instance: '/api/v1/no-existe',
      correlationId: 'client-req-0002',
    });
    expect(res.payload).not.toContain('token');
  });

  it('allows only the configured CORS origins', async () => {
    app = await start(allUp());
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/api/v1/health/live',
        headers: { origin, 'access-control-request-method': 'GET' },
      });
    const allowed = await preflight('http://localhost:4200');
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:4200',
    );
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const denied = await preflight('https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves OpenAPI only when SWAGGER_ENABLED is true', async () => {
    app = await start(allUp());
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/docs-json' }))
        .statusCode,
    ).toBe(404);
    await app.close();

    app = await start(allUp(), { SWAGGER_ENABLED: 'true' });
    const doc = await app.inject({ method: 'GET', url: '/api/v1/docs-json' });
    expect(doc.statusCode).toBe(200);
    expect(Object.keys(doc.json().paths)).toEqual(
      expect.arrayContaining(['/api/v1/health/live', '/api/v1/health/ready']),
    );
  });
});

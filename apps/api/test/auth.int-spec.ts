import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { COOKIE, ORIGIN, startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * CORE-02 end to end against a real PostgreSQL (ADR 0004): login, refresh rotation with reuse
 * detection, logout, profile, cookie flags, Origin check and login throttling.
 */

const PASSWORD = 'correct horse battery staple';
const ACTIVE_TENANT = '33333333-3333-4333-8333-333333333333';
const SUSPENDED_TENANT = '44444444-4444-4444-8444-444444444444';

let app: NestFastifyApplication;

async function seed(): Promise<void> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    const hash = await hashPassword(PASSWORD);
    await client.query(
      `INSERT INTO tenants (id, slug, name, status) VALUES
         ($1, 'feria-activa', 'Feria Activa', 'ACTIVE'),
         ($2, 'feria-suspendida', 'Feria Suspendida', 'SUSPENDED')`,
      [ACTIVE_TENANT, SUSPENDED_TENANT],
    );
    const { rows } = await client.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash, status) VALUES
         ('ana@example.com', $1, 'ACTIVE'),
         ('limit@example.com', $1, 'ACTIVE'),
         ('baja@example.com', $1, 'DISABLED')
       RETURNING id, email`,
      [hash],
    );
    const ana = rows.find((r) => r.email === 'ana@example.com')!.id;
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $3, 'OWNER'), ($2, $3, 'ADMIN')`,
      [ACTIVE_TENANT, SUSPENDED_TENANT, ana],
    );
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await seed();
  app = await startIntApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

const login = (email: string, password = PASSWORD) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });

const refresh = (token?: string, origin: string | null = ORIGIN) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    headers: origin ? { origin } : {},
    cookies: token ? { [COOKIE]: token } : {},
  });

const refreshCookie = (res: Awaited<ReturnType<typeof login>>) =>
  res.cookies.find((c) => c.name === COOKIE);

describe('auth (CORE-02, ADR 0004)', () => {
  it('logs in: access token in the body, refresh token only in a scoped HttpOnly cookie', async () => {
    const res = await login('ANA@example.com '); // case and spaces are not part of the identity

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { email: 'ana@example.com' },
      memberships: [
        { tenantId: ACTIVE_TENANT, tenantSlug: 'feria-activa', role: 'OWNER' },
      ],
    });
    expect(body.memberships).toHaveLength(1); // suspended tenant is not offered
    expect(body).not.toHaveProperty('refreshToken');
    expect(refreshCookie(res)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/api/v1/auth',
    });
  });

  it('answers wrong password, unknown and disabled users with the same 401', async () => {
    const answers = await Promise.all([
      login('ana@example.com', 'wrong'),
      login('nadie@example.com'),
      login('baja@example.com'),
    ]);
    for (const res of answers) {
      expect(res.statusCode).toBe(401);
      expect(res.json().detail ?? res.json().message).toMatch(
        /invalid email or password/i,
      );
      expect(refreshCookie(res)).toBeUndefined();
    }
  });

  it('rejects a malformed body with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('serves the profile only with a valid Bearer token', async () => {
    const { accessToken } = (await login('ana@example.com')).json();

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { email: 'ana@example.com' } });

    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['www-authenticate']).toBe('Bearer');

    const forged = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${accessToken}x` },
    });
    expect(forged.statusCode).toBe(401);
  });

  it('rotates the refresh token, and replaying a used one revokes the whole family', async () => {
    const first = refreshCookie(await login('ana@example.com'))!.value;

    const rotated = await refresh(first);
    expect(rotated.statusCode).toBe(200);
    const second = refreshCookie(rotated)!.value;
    expect(second).not.toBe(first);

    const replay = await refresh(first); // stolen copy of the old token
    expect(replay.statusCode).toBe(401);
    expect(refreshCookie(replay)?.value).toBe(''); // cookie cleared

    expect((await refresh(second)).statusCode).toBe(401); // legitimate holder is logged out too
  });

  it('lets only one of two concurrent refreshes with the same token succeed', async () => {
    const token = refreshCookie(await login('ana@example.com'))!.value;
    const results = await Promise.all([refresh(token), refresh(token)]);
    expect(results.map((r) => r.statusCode).sort((a, b) => a - b)).toEqual([
      200, 401,
    ]);
  });

  it('refuses refresh and logout from a foreign or missing Origin (CSRF)', async () => {
    const token = refreshCookie(await login('ana@example.com'))!.value;

    expect((await refresh(token, 'https://evil.example')).statusCode).toBe(403);
    expect((await refresh(token, null)).statusCode).toBe(403);
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin: 'https://evil.example' },
      cookies: { [COOKIE]: token },
    });
    expect(logout.statusCode).toBe(403);

    expect((await refresh(token)).statusCode).toBe(200); // token was untouched
  });

  it('logs out: revokes the session and clears the cookie', async () => {
    const token = refreshCookie(await login('ana@example.com'))!.value;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { origin: ORIGIN },
      cookies: { [COOKIE]: token },
    });
    expect(res.statusCode).toBe(204);
    expect(refreshCookie(res)?.value).toBe('');
    expect((await refresh(token)).statusCode).toBe(401);
  });

  it('throttles repeated failures on one email with 429 and Retry-After', async () => {
    for (let i = 0; i < 5; i++)
      expect((await login('limit@example.com', 'wrong')).statusCode).toBe(401);

    const blocked = await login('limit@example.com'); // even the right password
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});

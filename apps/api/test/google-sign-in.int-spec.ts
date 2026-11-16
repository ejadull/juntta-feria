import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import {
  GoogleKeys,
  GoogleKeysUnavailableError,
} from '../src/auth/google-keys.js';
import { COOKIE, startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';
import {
  GOOGLE_CLIENT_ID,
  googleFixture,
  type GoogleFixture,
} from './google-fixture.js';

/**
 * CORE-05 against a real PostgreSQL: "Sign in with Google" for existing accounts only, and
 * accepting an exhibitor invitation (EXH-04) with a Google credential. Google's keys are a
 * locally generated pair behind a stubbed JWKS.
 */

const PASSWORD = 'google sign-in test password';
const TENANT = 'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7';

let app: NestFastifyApplication;
let google: GoogleFixture;
let ownerToken = '';

async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function seed(): Promise<void> {
  await owner(async (client) => {
    const hash = await hashPassword(PASSWORD);
    await client.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'feria-google', 'Feria Google')`,
      [TENANT],
    );
    const { rows } = await client.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash, google_sub, status) VALUES
         ('ana@google.test', $1, NULL, 'ACTIVE'),
         ('bound@google.test', $1, 'sub-bound', 'ACTIVE'),
         ('limit@google.test', $1, 'sub-limit', 'ACTIVE'),
         ('baja@google.test', $1, NULL, 'DISABLED'),
         ('owner@google.test', $1, NULL, 'ACTIVE')
       RETURNING id, email`,
      [hash],
    );
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [TENANT, rows.find((r) => r.email === 'owner@google.test')!.id],
    );
    await client.query(
      `INSERT INTO users (email, google_sub) VALUES ('soloGoogle@google.test', 'sub-solo')`,
    );
    // Pending account (ADR 0008): only an email, no password, no Google subject yet.
    await client.query(
      `INSERT INTO users (email, status) VALUES ('pendiente@google.test', 'ACTIVE'), ('pendiente-b@google.test', 'ACTIVE')`,
    );
  });
}

beforeAll(async () => {
  await seed();
  google = await googleFixture();
  app = await startIntApp([], [[GoogleKeys, google.keys]], {
    GOOGLE_CLIENT_ID,
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'owner@google.test', password: PASSWORD },
  });
  ownerToken = res.json().accessToken;
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

type Claims = Parameters<GoogleFixture['idToken']>[0];

const post = (url: string, payload: object, a = app) =>
  a.inject({ method: 'POST', url: `/api/v1${url}`, payload });

const googleLogin = async (claims: Claims, a = app) =>
  post('/auth/google', { credential: await google.idToken(claims) }, a);

const subOf = (email: string) =>
  owner(async (c) => {
    const { rows } = await c.query(
      `SELECT google_sub FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    return rows[0]?.google_sub as string | null | undefined;
  });

describe('GET /auth/providers', () => {
  it('tells the web the client id, publicly', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/providers',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      google: { clientId: GOOGLE_CLIENT_ID },
      password: true,
    });
  });
});

describe('POST /auth/google (CORE-05)', () => {
  it('signs in by a stored Google subject, with the same session as password login', async () => {
    const res = await googleLogin({
      sub: 'sub-bound',
      email: 'bound@google.test',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { email: 'bound@google.test' },
      memberships: [],
    });
    expect(res.json()).not.toHaveProperty('refreshToken');
    expect(res.cookies.find((c) => c.name === COOKIE)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/api/v1/auth',
    });
  });

  it('matches the subject even if the Google email changed', async () => {
    const res = await googleLogin({
      sub: 'sub-bound',
      email: 'nuevo-mail@gmail.test',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('bound@google.test');
  });

  it('binds the subject by verified email (case-insensitive) on first success', async () => {
    expect(await subOf('ana@google.test')).toBeNull();
    const res = await googleLogin({ sub: 'sub-ana', email: 'ANA@Google.test' });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('ana@google.test');
    expect(await subOf('ana@google.test')).toBe('sub-ana');
    // from now on the subject alone identifies her
    expect(
      (await googleLogin({ sub: 'sub-ana', email: 'otro@gmail.test' }))
        .statusCode,
    ).toBe(200);
  });

  it('refuses an account already bound to a different Google subject (401)', async () => {
    const res = await googleLogin({
      sub: 'sub-impostor',
      email: 'ana@google.test',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'GOOGLE_ACCOUNT_MISMATCH' });
    expect(res.cookies.find((c) => c.name === COOKIE)).toBeUndefined();
    expect(await subOf('ana@google.test')).toBe('sub-ana');
  });

  it('never creates a user from a bare Google login (403)', async () => {
    const res = await googleLogin({
      sub: 'sub-stranger',
      email: 'nadie@google.test',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'GOOGLE_ACCOUNT_NOT_REGISTERED' });
    const count = await owner(async (c) => {
      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM users WHERE lower(email) = 'nadie@google.test' OR google_sub = 'sub-stranger'`,
      );
      return rows[0].n as number;
    });
    expect(count).toBe(0);
  });

  it('treats a disabled account like a failed password login and does not bind it', async () => {
    const res = await googleLogin({
      sub: 'sub-baja',
      email: 'baja@google.test',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('GOOGLE_CREDENTIAL_INVALID');
    expect(await subOf('baja@google.test')).toBeNull();
  });

  it('refuses unverified emails, another audience and garbage with 401', async () => {
    for (const credential of [
      await google.idToken({
        sub: 'sub-bound',
        email: 'bound@google.test',
        emailVerified: false,
      }),
      await google.idToken({
        sub: 'sub-bound',
        email: 'bound@google.test',
        aud: 'other.apps.googleusercontent.com',
      }),
      'not-a-jwt',
    ]) {
      const res = await post('/auth/google', { credential });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('GOOGLE_CREDENTIAL_INVALID');
      expect(res.cookies.find((c) => c.name === COOKIE)).toBeUndefined();
    }
  });

  it('rejects a body without credential (400)', async () => {
    expect((await post('/auth/google', {})).statusCode).toBe(400);
    expect((await post('/auth/google', { credential: 5 })).statusCode).toBe(
      400,
    );
  });

  it('binds a pending account (no password, no subject) on its first Google sign-in', async () => {
    expect(await subOf('pendiente@google.test')).toBeNull();
    const res = await googleLogin({
      sub: 'sub-pendiente',
      email: 'Pendiente@Google.test',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('pendiente@google.test');
    expect(await subOf('pendiente@google.test')).toBe('sub-pendiente');
  });

  it('fills a missing full name once from Google and returns it in the session', async () => {
    const first = await googleLogin({
      sub: 'sub-pendiente',
      email: 'pendiente@google.test',
      name: '  Paula Pendiente ',
    });
    expect(first.json().user.fullName).toBe('Paula Pendiente');
    const again = await googleLogin({
      sub: 'sub-pendiente',
      email: 'pendiente@google.test',
      name: 'Otro Nombre',
    });
    expect(again.json().user.fullName).toBe('Paula Pendiente'); // never overwritten
  });

  it('never matches a pending account by an unverified email', async () => {
    const res = await googleLogin({
      sub: 'sub-unverified',
      email: 'pendiente-b@google.test',
      emailVerified: false,
    });
    expect(res.statusCode).toBe(401);
    expect(await subOf('pendiente-b@google.test')).toBeNull();
  });

  it('lets a Google-only account in with Google but never with a password', async () => {
    expect(
      (await googleLogin({ sub: 'sub-solo', email: 'sologoogle@google.test' }))
        .statusCode,
    ).toBe(200);
    for (const password of [PASSWORD, 'x'])
      expect(
        (
          await post('/auth/login', {
            email: 'sologoogle@google.test',
            password,
          })
        ).statusCode,
      ).toBe(401);
  });
});

describe('without Google available (CORE-05)', () => {
  it('answers 503 GOOGLE_SIGN_IN_UNAVAILABLE and hides the provider', async () => {
    const bare = await startIntApp([], [], { GOOGLE_CLIENT_ID: '' });
    try {
      const res = await post('/auth/google', { credential: 'whatever' }, bare);
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: 'GOOGLE_SIGN_IN_UNAVAILABLE' });
      const providers = await bare.inject({
        method: 'GET',
        url: '/api/v1/auth/providers',
      });
      expect(providers.json()).toEqual({ google: null, password: true });
    } finally {
      await bare.close();
    }
  });

  it('answers 503 too when Google keys cannot be loaded', async () => {
    const down = new GoogleKeys(async () => {
      throw new GoogleKeysUnavailableError();
    });
    const broken = await startIntApp([], [[GoogleKeys, down]], {
      GOOGLE_CLIENT_ID,
    });
    try {
      const res = await post(
        '/auth/google',
        { credential: await google.idToken({ sub: 's', email: 'a@b.test' }) },
        broken,
      );
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: 'GOOGLE_SIGN_IN_UNAVAILABLE' });
    } finally {
      await broken.close();
    }
  });
});

describe('with password sign-in disabled, the default (ADR 0008)', () => {
  let off: NestFastifyApplication;

  beforeAll(async () => {
    off = await startIntApp([], [[GoogleKeys, google.keys]], {
      GOOGLE_CLIENT_ID,
      AUTH_PASSWORD_ENABLED: 'false',
    });
  }, 60_000);
  afterAll(async () => {
    await off?.close();
  });

  it('refuses POST /auth/login even with right credentials (403)', async () => {
    const res = await post(
      '/auth/login',
      { email: 'owner@google.test', password: PASSWORD },
      off,
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'PASSWORD_SIGN_IN_DISABLED' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('says so in GET /auth/providers', async () => {
    const res = await off.inject({
      method: 'GET',
      url: '/api/v1/auth/providers',
    });
    expect(res.json()).toEqual({
      google: { clientId: GOOGLE_CLIENT_ID },
      password: false,
    });
  });

  it('keeps Google sign-in working', async () => {
    const res = await googleLogin(
      { sub: 'sub-bound', email: 'bound@google.test' },
      off,
    );
    expect(res.statusCode).toBe(200);
  });

  it('refuses to accept an invitation with a password (403) and keeps the link usable', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/exhibitor-invitations',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'x-tenant-id': TENANT,
      },
      payload: {},
    });
    const token = (created.json().url as string).split('/').at(-1)!;
    const denied = await post(
      `/public/invitations/${token}/accept`,
      {
        fullName: 'Pedro Clave',
        email: 'clave@google.test',
        password: 'una clave larga y segura',
      },
      off,
    );
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'PASSWORD_SIGN_IN_DISABLED' });
    expect(await subOf('clave@google.test')).toBeUndefined();

    const ok = await post(
      `/public/invitations/${token}/accept`,
      {
        googleCredential: await google.idToken({
          sub: 'sub-clave',
          email: 'clave@google.test',
        }),
      },
      off,
    );
    expect(ok.statusCode).toBe(201);
  });
});

describe('accepting an invitation with Google (EXH-04, CORE-05)', () => {
  const invite = async (payload: object = {}) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/exhibitor-invitations',
      headers: {
        authorization: `Bearer ${ownerToken}`,
        'x-tenant-id': TENANT,
      },
      payload,
    });
    expect(res.statusCode).toBe(201);
    return (res.json().url as string).split('/').at(-1)!;
  };

  const accept = async (token: string, claims: Claims, extra: object = {}) =>
    post(`/public/invitations/${token}/accept`, {
      googleCredential: await google.idToken(claims),
      ...extra,
    });

  it('creates a confirmed exhibitor bound to Google, with no password', async () => {
    const token = await invite({ email: 'Invitada@google.test' });
    const res = await accept(
      token,
      {
        sub: 'sub-invitada',
        email: 'INVITADA@google.test',
        name: 'Ines Invitada',
      },
      { phone: '+54 9 11 2345-6789' },
    );
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      user: { email: 'invitada@google.test' },
      tenantId: TENANT,
    });

    const row = await owner(async (c) => {
      const { rows } = await c.query(
        `SELECT password_hash, google_sub, full_name, phone, confirmed_at FROM users WHERE email = 'invitada@google.test'`,
      );
      return rows[0];
    });
    expect(row).toMatchObject({
      password_hash: null,
      google_sub: 'sub-invitada',
      full_name: 'Ines Invitada',
      phone: '5491123456789',
    });
    expect(row.confirmed_at).toBeInstanceOf(Date);

    const session = await googleLogin({
      sub: 'sub-invitada',
      email: 'invitada@google.test',
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().memberships).toEqual([
      expect.objectContaining({ tenantId: TENANT, role: 'EXHIBITOR' }),
    ]);
    expect(
      (
        await post('/auth/login', {
          email: 'invitada@google.test',
          password: 'cualquier clave larga',
        })
      ).statusCode,
    ).toBe(401);
    const again = await accept(token, {
      sub: 'sub-invitada',
      email: 'invitada@google.test',
    });
    expect(again.statusCode).toBe(404); // one-time link
  });

  it('refuses a Google email other than the invited one (422) and keeps the link usable', async () => {
    const token = await invite({ email: 'esperada@google.test' });
    const res = await accept(token, {
      sub: 'sub-otra',
      email: 'otra@google.test',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'INVITATION_EMAIL_MISMATCH' });
    expect(await subOf('otra@google.test')).toBeUndefined();

    const ok = await accept(token, {
      sub: 'sub-esperada',
      email: 'esperada@google.test',
    });
    expect(ok.statusCode).toBe(201);
  });

  it('takes the Google email when the invitation names none', async () => {
    const token = await invite();
    const res = await accept(token, {
      sub: 'sub-libre',
      email: 'libre@google.test',
      name: 'Lia Libre',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe('libre@google.test');
  });

  it('refuses an invalid credential (401) and a mixed body (400)', async () => {
    const token = await invite();
    const bad = await post(`/public/invitations/${token}/accept`, {
      googleCredential: 'junk',
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().code).toBe('GOOGLE_CREDENTIAL_INVALID');

    const mixed = await accept(
      token,
      { sub: 'sub-mix', email: 'mix@google.test' },
      { password: 'una clave larga y segura' },
    );
    expect(mixed.statusCode).toBe(400);
  });

  it('refuses an email that already has an account (409)', async () => {
    const token = await invite();
    const res = await accept(token, {
      sub: 'sub-ana-2',
      email: 'ana@google.test',
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('login rate limiter on Google sign-in (CORE-05)', () => {
  let fresh: NestFastifyApplication; // its own counters: the IP budget is shared inside one app

  beforeAll(async () => {
    fresh = await startIntApp([], [[GoogleKeys, google.keys]], {
      GOOGLE_CLIENT_ID,
    });
  }, 60_000);
  afterAll(async () => {
    await fresh?.close();
  });

  it('applies the login rate limiter per email: 429 with Retry-After', async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (
          await googleLogin(
            { sub: 'sub-wrong', email: 'limit@google.test' },
            fresh,
          )
        ).statusCode,
      ).toBe(401);
    const blocked = await googleLogin(
      {
        sub: 'sub-limit', // even the right account
        email: 'limit@google.test',
      },
      fresh,
    );
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('applies the per-IP limit to invalid credentials too', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++)
      statuses.push(
        (await post('/auth/google', { credential: 'junk' }, fresh)).statusCode,
      );
    // 20 per IP per window, 6 already spent by the previous test of this app.
    const first429 = statuses.indexOf(429);
    expect(first429).toBe(14);
    expect(statuses.slice(0, first429).every((s) => s === 401)).toBe(true);
  });
});

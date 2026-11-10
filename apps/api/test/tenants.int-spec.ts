import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * CORE-04 against a real PostgreSQL: the platform superadministrator creates organizations and
 * their first OWNER over HTTP; nobody else can.
 */

const PASSWORD = 'platform admin test password';
const OWNER_PASSWORD = 'brand new owner password';
const EXISTING_PASSWORD = 'existing user password 1';

let app: NestFastifyApplication;
let adminToken = '';
let regularToken = '';

async function owner<R>(fn: (c: pg.Client) => Promise<R>): Promise<R> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function seed(): Promise<void> {
  await owner(async (c) => {
    const hash = await hashPassword(PASSWORD);
    await c.query(
      `INSERT INTO users (email, password_hash, is_platform_admin, confirmed_at)
       VALUES ('root@platform.test', $1, true, now()), ('regular@platform.test', $1, false, now())`,
      [hash],
    );
    await c.query(
      `INSERT INTO users (email, password_hash, confirmed_at) VALUES ('existing@platform.test', $1, now())`,
      [await hashPassword(EXISTING_PASSWORD)],
    );
  });
}

const login = (email: string, password = PASSWORD) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });

const createTenant = (payload: object, token = adminToken) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/tenants',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload,
  });

const body = (slug: string, email: string, password = OWNER_PASSWORD) => ({
  name: `Org ${slug}`,
  slug,
  owner: { email, fullName: 'Ana Owner', password },
});

beforeAll(async () => {
  await seed();
  app = await startIntApp();
  adminToken = (await login('root@platform.test')).json().accessToken;
  regularToken = (await login('regular@platform.test')).json().accessToken;
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

describe('platform administration (CORE-04)', () => {
  it('creates an organization with a new owner who can sign in and manage it', async () => {
    const res = await createTenant(body('feria-uno', 'Owner1@Platform.test'));
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created).toMatchObject({
      name: 'Org feria-uno',
      slug: 'feria-uno',
      owner: { email: 'owner1@platform.test', created: true },
    });
    expect(created.owner).not.toHaveProperty('password');

    const session = await login('owner1@platform.test', OWNER_PASSWORD);
    expect(session.statusCode).toBe(200);
    expect(session.json().memberships).toEqual([
      expect.objectContaining({ tenantId: created.id, role: 'OWNER' }),
    ]);
    const venues = await app.inject({
      method: 'GET',
      url: '/api/v1/venues',
      headers: {
        authorization: `Bearer ${session.json().accessToken}`,
        'x-tenant-id': created.id,
      },
    });
    expect(venues.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${session.json().accessToken}` },
    });
    expect(me.json().platformAdmin).toBe(false);
  });

  it('records tenant.created in the new organization audit trail', async () => {
    const res = await createTenant(
      body('feria-audit', 'owner-audit@platform.test'),
    );
    const rows = await owner((c) =>
      c.query(
        `SELECT actor_id, entity_type, entity_id, after_json FROM audit_logs
         WHERE tenant_id = $1 AND action = 'tenant.created'`,
        [res.json().id],
      ),
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({
      entity_type: 'tenant',
      entity_id: res.json().id,
    });
    expect(rows.rows[0].actor_id).toBeTruthy();
    expect(JSON.stringify(rows.rows[0].after_json)).not.toContain(
      OWNER_PASSWORD,
    );
  });

  it('reuses an existing user without touching its password', async () => {
    const res = await createTenant(
      body('feria-dos', 'existing@platform.test', 'a different password!!'),
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().owner).toMatchObject({
      email: 'existing@platform.test',
      created: false,
    });

    expect(
      (await login('existing@platform.test', EXISTING_PASSWORD)).statusCode,
    ).toBe(200);
    expect(
      (await login('existing@platform.test', 'a different password!!'))
        .statusCode,
    ).toBe(401);
    const roles = await owner((c) =>
      c.query(
        `SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE u.email = 'existing@platform.test' AND m.tenant_id = $1`,
        [res.json().id],
      ),
    );
    expect(roles.rows).toEqual([{ role: 'OWNER' }]);
  });

  it('rejects a duplicate slug with 409 TENANT_SLUG_TAKEN and creates nothing', async () => {
    const res = await createTenant(body('feria-uno', 'nobody@platform.test'));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('TENANT_SLUG_TAKEN');
    const users = await owner((c) =>
      c.query(`SELECT 1 FROM users WHERE email = 'nobody@platform.test'`),
    );
    expect(users.rowCount).toBe(0);
  });

  it('answers 403 to a signed-in user who is not a platform admin', async () => {
    const res = await createTenant(
      body('feria-tres', 'x@platform.test'),
      regularToken,
    );
    expect(res.statusCode).toBe(403);
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants',
      headers: { authorization: `Bearer ${regularToken}` },
    });
    expect(list.statusCode).toBe(403);
  });

  it('answers 401 without credentials', async () => {
    expect(
      (await createTenant(body('feria-cuatro', 'y@platform.test'), ''))
        .statusCode,
    ).toBe(401);
    const list = await app.inject({ method: 'GET', url: '/api/v1/tenants' });
    expect(list.statusCode).toBe(401);
  });

  it.each([
    ['uppercase slug', body('Bad Slug', 'z@platform.test')],
    ['weak password', body('feria-cinco', 'z@platform.test', 'short')],
    ['bad email', body('feria-seis', 'not-an-email')],
    ['missing owner', { name: 'X', slug: 'feria-siete' }],
    ['unknown field', { ...body('feria-ocho', 'z@platform.test'), extra: 1 }],
  ])('rejects an invalid body with 400 (%s)', async (_label, payload) => {
    const res = await createTenant(payload);
    expect(res.statusCode).toBe(400);
  });

  it('exposes platformAdmin in /auth/me', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(me.json()).toMatchObject({
      user: { email: 'root@platform.test' },
      platformAdmin: true,
    });
  });

  it('lists organizations for platform admins', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const slugs = (res.json() as { slug: string }[]).map((t) => t.slug);
    expect(slugs).toEqual(expect.arrayContaining(['feria-uno', 'feria-dos']));
  });
});

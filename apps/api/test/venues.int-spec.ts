import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import { startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/** VEN-01 against a real PostgreSQL: venue CRUD scoped by tenant, validated, audited, RLS-isolated. */

const PASSWORD = 'venues test password';
const V_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const V_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const MISSING = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3';

let app: NestFastifyApplication;
let database: DatabaseService;
const tokens: Record<'owner' | 'operator' | 'exhibitor', string> = {
  owner: '',
  operator: '',
  exhibitor: '',
};

async function seed(): Promise<void> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    const hash = await hashPassword(PASSWORD);
    await client.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'venues-a', 'Venues A'), ($2, 'venues-b', 'Venues B')`,
      [V_A, V_B],
    );
    const { rows } = await client.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash) VALUES
         ('owner@venues.test', $1), ('operator@venues.test', $1), ('exhibitor@venues.test', $1)
       RETURNING id, email`,
      [hash],
    );
    const id = (email: string) => rows.find((r) => r.email === email)!.id;
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES
         ($1, $3, 'OWNER'), ($2, $3, 'OWNER'), ($1, $4, 'OPERATOR'), ($1, $5, 'EXHIBITOR')`,
      [
        V_A,
        V_B,
        id('owner@venues.test'),
        id('operator@venues.test'),
        id('exhibitor@venues.test'),
      ],
    );
  } finally {
    await client.end();
  }
}

async function login(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  return res.json().accessToken as string;
}

beforeAll(async () => {
  await seed();
  app = await startIntApp();
  database = app.get(DatabaseService);
  tokens.owner = await login('owner@venues.test');
  tokens.operator = await login('operator@venues.test');
  tokens.exhibitor = await login('exhibitor@venues.test');
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  who: keyof typeof tokens,
  tenant: string,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/api/v1/venues${path}`,
    headers: { authorization: `Bearer ${tokens[who]}`, 'x-tenant-id': tenant },
    ...(payload ? { payload } : {}),
  });

const predio = {
  type: 'FIXED',
  name: 'Predio Ferial Norte',
  address: 'Av. Siempreviva 742, Rosario',
  timezone: 'America/Argentina/Buenos_Aires',
  widthM: 120.5,
  heightM: 80,
};

const auditActions = async (tenant: string, entityId: string) =>
  (
    await database.withTenant(tenant, (tx) =>
      tx.execute(
        sql`SELECT action FROM audit_logs WHERE entity_id = ${entityId} ORDER BY created_at`,
      ),
    )
  ).rows.map((r) => r.action);

describe('venues (VEN-01)', () => {
  let created: { id: string };

  it('creates a venue for the tenant and audits it', async () => {
    const res = await call('POST', '', 'operator', V_A, predio);
    expect(res.statusCode).toBe(201);
    created = res.json();
    expect(created).toMatchObject({ ...predio, id: expect.any(String) });
    expect(await auditActions(V_A, created.id)).toEqual(['venue.created']);
  });

  it.each([
    ['unknown type', { type: 'FLOATING' }],
    ['blank name', { name: '   ' }],
    ['zero width', { widthM: 0 }],
    ['negative height', { heightM: -1 }],
    ['three decimals', { widthM: 10.123 }],
    ['unknown time zone', { timezone: 'Mars/Olympus' }],
    ['extra field', { tenantId: V_B }],
  ])('rejects %s with 400', async (_case, change) => {
    const res = await call('POST', '', 'operator', V_A, {
      ...predio,
      name: `Otro ${_case}`,
      ...change,
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a duplicate name in the same tenant, ignoring case and spaces', async () => {
    const res = await call('POST', '', 'operator', V_A, {
      ...predio,
      name: '  predio ferial NORTE ',
    });
    expect(res.statusCode).toBe(409);
    expect((await call('POST', '', 'owner', V_B, predio)).statusCode).toBe(201); // other tenant
  });

  it('lists only the tenant venues, by name', async () => {
    await call('POST', '', 'operator', V_A, {
      ...predio,
      type: 'TEMPORARY',
      name: 'Anfiteatro',
    });
    const res = await call('GET', '', 'operator', V_A);
    expect(res.statusCode).toBe(200);
    expect(res.json().map((v: { name: string }) => v.name)).toEqual([
      'Anfiteatro',
      'Predio Ferial Norte',
    ]);
  });

  it('answers 404 for another tenant venue, an unknown id or a malformed id', async () => {
    expect((await call('GET', `/${created.id}`, 'owner', V_B)).statusCode).toBe(
      404,
    );
    expect(
      (await call('PATCH', `/${created.id}`, 'owner', V_B, { name: 'X' }))
        .statusCode,
    ).toBe(404);
    expect((await call('GET', `/${MISSING}`, 'owner', V_A)).statusCode).toBe(
      404,
    );
    expect((await call('GET', '/not-a-uuid', 'owner', V_A)).statusCode).toBe(
      404,
    );
    expect(
      (await call('GET', `/${created.id}`, 'owner', V_A)).json(),
    ).toMatchObject(predio);
  });

  it('updates some fields and audits before/after', async () => {
    const res = await call('PATCH', `/${created.id}`, 'operator', V_A, {
      widthM: 150,
      address: null,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ...predio, widthM: 150, address: null });
    const { rows } = await database.withTenant(V_A, (tx) =>
      tx.execute(
        sql`SELECT before_json->>'widthM' AS before, after_json->>'widthM' AS after
            FROM audit_logs WHERE entity_id = ${created.id} AND action = 'venue.updated'`,
      ),
    );
    expect(rows).toEqual([{ before: '120.5', after: '150' }]);
  });

  it('rejects an empty or invalid update with 400', async () => {
    expect(
      (await call('PATCH', `/${created.id}`, 'operator', V_A, {})).statusCode,
    ).toBe(400);
    expect(
      (await call('PATCH', `/${created.id}`, 'operator', V_A, { heightM: 0 }))
        .statusCode,
    ).toBe(400);
  });

  it('enforces roles: exhibitors cannot read, operators cannot delete', async () => {
    expect((await call('GET', '', 'exhibitor', V_A)).statusCode).toBe(403);
    expect(
      (await call('DELETE', `/${created.id}`, 'operator', V_A)).statusCode,
    ).toBe(403);
  });

  it('lets an owner delete and audits it', async () => {
    expect(
      (await call('DELETE', `/${created.id}`, 'owner', V_A)).statusCode,
    ).toBe(204);
    expect((await call('GET', `/${created.id}`, 'owner', V_A)).statusCode).toBe(
      404,
    );
    expect(await auditActions(V_A, created.id)).toEqual([
      'venue.created',
      'venue.updated',
      'venue.deleted',
    ]);
  });

  it('keeps venues invisible outside a tenant transaction (RLS)', async () => {
    const { rows } = await database.db.execute(sql`SELECT 1 FROM venues`);
    expect(rows).toEqual([]);
  });
});

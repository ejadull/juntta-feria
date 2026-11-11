import { readFileSync } from 'node:fs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import { startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * EXH-02 against a real PostgreSQL: rubros per organization (unique name, in-use delete → 409),
 * the exhibitor picks one of its own organization, RLS isolation, and the migration of the old
 * free-text `exhibitors.category`.
 */

const PASSWORD = 'categories test password';
const C_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const C_B = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';

let app: NestFastifyApplication;
let database: DatabaseService;
const tokens = { owner: '', operator: '', ana: '', ownerB: '' };

async function seed(): Promise<void> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    const hash = await hashPassword(PASSWORD);
    await client.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'categories-a', 'Categories A'), ($2, 'categories-b', 'Categories B')`,
      [C_A, C_B],
    );
    const { rows } = await client.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash) VALUES
         ('owner@categories.test', $1), ('operator@categories.test', $1),
         ('ana@categories.test', $1), ('ownerb@categories.test', $1)
       RETURNING id, email`,
      [hash],
    );
    const id = (email: string) => rows.find((r) => r.email === email)!.id;
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES
         ($1, $3, 'OWNER'), ($1, $4, 'OPERATOR'), ($1, $5, 'EXHIBITOR'), ($2, $6, 'OWNER')`,
      [
        C_A,
        C_B,
        id('owner@categories.test'),
        id('operator@categories.test'),
        id('ana@categories.test'),
        id('ownerb@categories.test'),
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
  tokens.owner = await login('owner@categories.test');
  tokens.operator = await login('operator@categories.test');
  tokens.ana = await login('ana@categories.test');
  tokens.ownerB = await login('ownerb@categories.test');
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  who: keyof typeof tokens,
  tenant = C_A,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${tokens[who]}`, 'x-tenant-id': tenant },
    ...(payload ? { payload } : {}),
  });

describe('exhibitor categories (EXH-02)', () => {
  let textiles = '';

  it('starts empty and lets organizers create rubros', async () => {
    expect(
      (await call('GET', '/exhibitor-categories', 'owner')).json(),
    ).toEqual([]);
    const created = await call(
      'POST',
      '/exhibitor-categories',
      'operator',
      C_A,
      { name: '  Textiles ' },
    );
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'Textiles',
      exhibitorCount: 0,
    });
    textiles = created.json().id;
  });

  it('rejects a repeated name regardless of case and spaces (409 CATEGORY_EXISTS)', async () => {
    const res = await call('POST', '/exhibitor-categories', 'owner', C_A, {
      name: 'textiles',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CATEGORY_EXISTS');
  });

  it('allows the same name in another organization and keeps lists separate', async () => {
    const res = await call('POST', '/exhibitor-categories', 'ownerB', C_B, {
      name: 'Textiles',
    });
    expect(res.statusCode).toBe(201);
    const listB = await call('GET', '/exhibitor-categories', 'ownerB', C_B);
    expect(listB.json()).toHaveLength(1);
    expect(listB.json()[0].id).not.toBe(textiles);
  });

  it.each([
    ['a blank name', { name: '   ' }],
    ['a name that is too long', { name: 'x'.repeat(61) }],
    ['an unknown field', { name: 'Ok', tenantId: C_B }],
  ])('rejects %s (400)', async (_case, payload) => {
    expect(
      (await call('POST', '/exhibitor-categories', 'owner', C_A, payload))
        .statusCode,
    ).toBe(400);
  });

  it('renames a rubro and audits it; a clash is a 409', async () => {
    await call('POST', '/exhibitor-categories', 'owner', C_A, {
      name: 'Comida',
    });
    const clash = await call(
      'PATCH',
      `/exhibitor-categories/${textiles}`,
      'owner',
      C_A,
      { name: 'comida' },
    );
    expect(clash.statusCode).toBe(409);
    const renamed = await call(
      'PATCH',
      `/exhibitor-categories/${textiles}`,
      'owner',
      C_A,
      { name: 'Indumentaria' },
    );
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().name).toBe('Indumentaria');
    const { rows } = await database.withTenant(C_A, (tx) =>
      tx.execute(
        sql`SELECT action FROM audit_logs WHERE entity_id = ${textiles} ORDER BY created_at`,
      ),
    );
    expect(rows.map((r) => r.action)).toEqual([
      'exhibitor_category.created',
      'exhibitor_category.updated',
    ]);
  });

  it('lets the exhibitor read rubros but not change them', async () => {
    expect((await call('GET', '/exhibitor-categories', 'ana')).statusCode).toBe(
      200,
    );
    for (const [method, url] of [
      ['POST', '/exhibitor-categories'],
      ['PATCH', `/exhibitor-categories/${textiles}`],
      ['DELETE', `/exhibitor-categories/${textiles}`],
    ] as const)
      expect(
        (await call(method, url, 'ana', C_A, { name: 'X' })).statusCode,
      ).toBe(403);
  });

  it('shows the rubro name on the exhibitor profile and counts its use', async () => {
    const saved = await call('PUT', '/me/exhibitor-profile', 'ana', C_A, {
      legalName: 'Ana S.A.',
      tradeName: 'Ana',
      categoryId: textiles,
      publicContactOptIn: false,
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json()).toMatchObject({
      categoryId: textiles,
      category: 'Indumentaria',
    });
    const list = (await call('GET', '/exhibitor-categories', 'owner')).json();
    expect(list.find((c: { id: string }) => c.id === textiles)).toMatchObject({
      exhibitorCount: 1,
    });
    expect((await call('GET', '/exhibitors', 'owner')).json()[0]).toMatchObject(
      { category: 'Indumentaria' },
    );
  });

  it('refuses to delete a rubro in use (409 CATEGORY_IN_USE)', async () => {
    const res = await call(
      'DELETE',
      `/exhibitor-categories/${textiles}`,
      'owner',
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CATEGORY_IN_USE');
  });

  it('deletes an unused rubro (204) and audits it', async () => {
    const created = await call('POST', '/exhibitor-categories', 'owner', C_A, {
      name: 'Temporal',
    });
    const id = created.json().id as string;
    expect(
      (await call('DELETE', `/exhibitor-categories/${id}`, 'owner')).statusCode,
    ).toBe(204);
    expect(
      (await call('DELETE', `/exhibitor-categories/${id}`, 'owner')).statusCode,
    ).toBe(404);
    const { rows } = await database.withTenant(C_A, (tx) =>
      tx.execute(sql`SELECT action FROM audit_logs WHERE entity_id = ${id}`),
    );
    expect(rows.map((r) => r.action)).toContain('exhibitor_category.deleted');
  });

  it('does not expose or touch rubros of another organization', async () => {
    const [foreign] = (
      await call('GET', '/exhibitor-categories', 'ownerB', C_B)
    ).json();
    expect(
      (
        await call(
          'PATCH',
          `/exhibitor-categories/${foreign.id}`,
          'owner',
          C_A,
          { name: 'Hack' },
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await call('DELETE', `/exhibitor-categories/${foreign.id}`, 'owner'))
        .statusCode,
    ).toBe(404);
    expect(
      (await call('GET', '/exhibitor-categories', 'owner', C_B)).statusCode,
    ).toBe(404);
  });

  it('keeps rubros invisible outside a tenant transaction (RLS)', async () => {
    const { rows } = await database.db.execute(
      sql`SELECT 1 FROM exhibitor_categories`,
    );
    expect(rows).toEqual([]);
  });
});

describe('migration 0020: free-text category to exhibitor_categories', () => {
  /** Runs the data step of the real migration on a scratch schema holding the old shape. */
  it('creates one rubro per tenant and name (case-insensitive) and links every exhibitor', async () => {
    const file = readFileSync(
      new URL(
        '../drizzle/0020_exhibitor_categories_documents.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const block = /DO \$\$[\s\S]*?END \$\$;/.exec(file)?.[0];
    expect(block).toBeDefined();

    const client = new pg.Client({ connectionString: ownerTestUrl() });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE SCHEMA mig_check');
      await client.query('SET LOCAL search_path = mig_check');
      await client.query(`
        CREATE TABLE tenants (id uuid PRIMARY KEY);
        CREATE TABLE exhibitor_categories (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL, name text NOT NULL);
        CREATE TABLE exhibitors (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id uuid NOT NULL, category text, category_id uuid);
      `);
      await client.query(`INSERT INTO tenants VALUES ($1), ($2)`, [C_A, C_B]);
      await client.query(
        `INSERT INTO exhibitors (tenant_id, category) VALUES
           ($1, 'Textiles'), ($1, ' textiles '), ($1, 'Cerámica'), ($2, 'TEXTILES')`,
        [C_A, C_B],
      );
      await client.query(block!);
      const cats = await client.query(
        `SELECT tenant_id, count(*)::int AS n FROM exhibitor_categories GROUP BY tenant_id ORDER BY n DESC`,
      );
      expect(cats.rows).toEqual([
        { tenant_id: C_A, n: 2 },
        { tenant_id: C_B, n: 1 },
      ]);
      const linked = await client.query(
        `SELECT c.name, e.tenant_id = c.tenant_id AS same_tenant
         FROM exhibitors e JOIN exhibitor_categories c ON c.id = e.category_id`,
      );
      expect(linked.rows).toHaveLength(4);
      expect(linked.rows.every((r) => r.same_tenant)).toBe(true);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});

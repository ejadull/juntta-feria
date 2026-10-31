import { execFileSync } from 'node:child_process';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { DatabaseService } from '../src/db/database.service.js';

/**
 * CORE-01 against a real PostgreSQL (ADR 0005): roles, migrations, RLS and tenant transactions.
 * Uses a throwaway `<db>_test` database, recreated on every run; never the development data.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is required for integration tests (see README).`);
  return value;
}

const ownerUrl = new URL(required('DATABASE_MIGRATION_URL'));
const appPassword = required('APP_DB_PASSWORD');
const testDb = `${ownerUrl.pathname.slice(1)}_test`;

const withDb = (db: string, user?: string, password?: string): string => {
  const url = new URL(ownerUrl);
  url.pathname = `/${db}`;
  if (user) url.username = user;
  if (password) url.password = password;
  return url.toString();
};
const OWNER_TEST_URL = withDb(testDb);
const APP_TEST_URL = withDb(testDb, 'juntta_app', appPassword);

async function asOwner<T>(
  fn: (c: pg.Client) => Promise<T>,
  url = OWNER_TEST_URL,
): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const runSetup = (env: Record<string, string | undefined> = {}): string =>
  execFileSync(process.execPath, ['scripts/db-setup.mjs'], {
    env: {
      ...process.env,
      DATABASE_MIGRATION_URL: OWNER_TEST_URL,
      APP_DB_PASSWORD: appPassword,
      ...env,
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

let setupOutput = '';
let db: DatabaseService;

beforeAll(async () => {
  await asOwner(async (c) => {
    await c.query(
      `DROP DATABASE IF EXISTS ${c.escapeIdentifier(testDb)} WITH (FORCE)`,
    );
    await c.query(`CREATE DATABASE ${c.escapeIdentifier(testDb)}`);
  }, withDb('postgres'));
  setupOutput = runSetup();
  db = new DatabaseService(
    new pg.Pool({ connectionString: APP_TEST_URL, max: 1 }),
  );
}, 120_000);

afterAll(async () => {
  await db?.onModuleDestroy();
});

describe('db:setup (CORE-01)', () => {
  it('creates juntta_app without superuser, BYPASSRLS or role/database creation', async () => {
    const { rows } = await asOwner((c) =>
      c.query(
        `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
           FROM pg_roles WHERE rolname = 'juntta_app'`,
      ),
    );
    expect(rows).toEqual([
      {
        rolcanlogin: true,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      },
    ]);
  });

  it('applies the migrations: postgis, pgcrypto and tenants', async () => {
    const { rows } = await asOwner((c) =>
      c.query(
        `SELECT array_agg(extname ORDER BY extname) AS ext, to_regclass('public.tenants') AS tenants
           FROM pg_extension WHERE extname IN ('postgis', 'pgcrypto')`,
      ),
    );
    expect(rows[0]).toEqual({
      ext: ['pgcrypto', 'postgis'],
      tenants: 'tenants',
    });
  });

  it('reports what it did without printing any credential', () => {
    expect(setupOutput).toContain('juntta_app');
    expect(setupOutput).not.toContain(appPassword);
    expect(setupOutput).not.toContain(decodeURIComponent(ownerUrl.password));
  });

  it('is idempotent: a second run changes nothing and keeps one entry per migration', async () => {
    runSetup();
    const { rows } = await asOwner((c) =>
      c.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations'),
    );
    expect(rows[0].n).toBe(2);
  });

  it('fails naming the missing variable, without echoing values', () => {
    let stderr = '';
    try {
      runSetup({ APP_DB_PASSWORD: '' });
    } catch (e) {
      stderr = String((e as { stderr?: string }).stderr);
    }
    expect(stderr).toContain('APP_DB_PASSWORD');
    expect(stderr).not.toContain(decodeURIComponent(ownerUrl.password));
  });
});

describe('juntta_app and DatabaseService (CORE-01, §2.2)', () => {
  it('reads and writes data but cannot run DDL', async () => {
    await db.db.execute(
      sql`INSERT INTO tenants (id, slug, name) VALUES (${T1}, 'demo-a', 'Demo A')`,
    );
    const { rows } = await db.db.execute(
      sql`SELECT slug FROM tenants WHERE id = ${T1}`,
    );
    expect(rows).toEqual([{ slug: 'demo-a' }]);
    await expect(
      db.db.execute(sql`CREATE TABLE app_ddl_probe (id int)`),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot bypass RLS; withTenant only sees the current tenant rows', async () => {
    await asOwner(async (c) => {
      await c.query(
        `CREATE TABLE rls_probe (tenant_id uuid NOT NULL, label text NOT NULL)`,
      );
      await c.query(`ALTER TABLE rls_probe ENABLE ROW LEVEL SECURITY`);
      await c.query(
        `CREATE POLICY tenant_isolation ON rls_probe
           USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`,
      );
      await c.query(`INSERT INTO rls_probe VALUES ($1, 'a'), ($2, 'b')`, [
        T1,
        T2,
      ]);
    });

    const outside = await db.db.execute(sql`SELECT label FROM rls_probe`);
    expect(outside.rows).toEqual([]);

    const inside = await db.withTenant(T1, (tx) =>
      tx.execute(sql`SELECT label FROM rls_probe`),
    );
    expect(inside.rows).toEqual([{ label: 'a' }]);
  });

  it('keeps the tenant setting inside the transaction (no leak on a pooled connection)', async () => {
    await db.withTenant(T2, (tx) => tx.execute(sql`SELECT 1`));
    const { rows } = await db.db.execute(
      sql`SELECT coalesce(current_setting('app.tenant_id', true), '') AS tenant`,
    );
    expect(rows).toEqual([{ tenant: '' }]);
  });

  it('rejects a tenant id that is not a UUID before touching the database', async () => {
    await expect(db.withTenant("x' OR true --", async () => 1)).rejects.toThrow(
      /tenant id/i,
    );
  });
});

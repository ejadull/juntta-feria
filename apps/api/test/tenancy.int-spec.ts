import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import { AuditService } from '../src/tenancy/audit.service.js';
import {
  TenantScoped,
  type TenantRequest,
} from '../src/tenancy/tenant-scoped.decorator.js';
import { startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * CORE-03 against a real PostgreSQL: tenant selection by X-Tenant-Id with membership and role
 * checks (uniform 404 for foreign tenants, §9), and the append-only, RLS-isolated audit log.
 */

const PASSWORD = 'tenancy test password';
const T_A = '55555555-5555-4555-8555-555555555555';
const T_B = '66666666-6666-4666-8666-666666666666';
const T_SUSPENDED = '77777777-7777-4777-8777-777777777777';
const UNKNOWN = '88888888-8888-4888-8888-888888888888';

@Controller('tenancy-probe')
class ProbeController {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @TenantScoped('OWNER', 'OPERATOR')
  whoami(@Req() request: TenantRequest) {
    return request.tenant;
  }

  @Post()
  @HttpCode(204)
  @TenantScoped('OWNER')
  async act(@Req() request: TenantRequest): Promise<void> {
    await this.database.withTenant(request.tenant.id, (tx) =>
      this.audit.record(tx, {
        actorId: request.user.id,
        action: 'probe.act',
        entityType: 'probe',
        entityId: null,
        after: { ok: true },
      }),
    );
  }
}

let app: NestFastifyApplication;
let database: DatabaseService;
let audit: AuditService;
let ownerId = '';

async function seed(): Promise<void> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    const hash = await hashPassword(PASSWORD);
    await client.query(
      `INSERT INTO tenants (id, slug, name, status) VALUES
         ($1, 'tenancy-a', 'Tenancy A', 'ACTIVE'),
         ($2, 'tenancy-b', 'Tenancy B', 'ACTIVE'),
         ($3, 'tenancy-suspendida', 'Tenancy Suspendida', 'SUSPENDED')`,
      [T_A, T_B, T_SUSPENDED],
    );
    const { rows } = await client.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash) VALUES
         ('owner@tenancy.test', $1), ('operator@tenancy.test', $1),
         ('exhibitor@tenancy.test', $1), ('former@tenancy.test', $1)
       RETURNING id, email`,
      [hash],
    );
    const id = (email: string) => rows.find((r) => r.email === email)!.id;
    ownerId = id('owner@tenancy.test');
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role, status) VALUES
         ($1, $3, 'OWNER', 'ACTIVE'), ($2, $3, 'OWNER', 'ACTIVE'),
         ($1, $4, 'OPERATOR', 'ACTIVE'), ($1, $5, 'EXHIBITOR', 'ACTIVE'),
         ($1, $6, 'OWNER', 'DISABLED')`,
      [
        T_A,
        T_SUSPENDED,
        ownerId,
        id('operator@tenancy.test'),
        id('exhibitor@tenancy.test'),
        id('former@tenancy.test'),
      ],
    );
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await seed();
  app = await startIntApp([ProbeController]);
  database = app.get(DatabaseService);
  audit = app.get(AuditService);
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

async function tokenFor(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return res.json().accessToken as string;
}

const probe = (method: 'GET' | 'POST', token: string | null, tenant?: string) =>
  app.inject({
    method,
    url: '/api/v1/tenancy-probe',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(tenant ? { 'x-tenant-id': tenant } : {}),
    },
  });

describe('tenant selection (CORE-03, X-Tenant-Id)', () => {
  it('requires authentication before anything else', async () => {
    expect((await probe('GET', null, T_A)).statusCode).toBe(401);
  });

  it('answers 400 when the tenant header is missing or not a UUID', async () => {
    const token = await tokenFor('operator@tenancy.test');
    expect((await probe('GET', token)).statusCode).toBe(400);
    expect((await probe('GET', token, "x' OR 1=1")).statusCode).toBe(400);
  });

  it('answers the same 404 for a foreign, unknown or suspended tenant and a disabled membership', async () => {
    const owner = await tokenFor('owner@tenancy.test');
    const former = await tokenFor('former@tenancy.test');
    const answers = await Promise.all([
      probe('GET', owner, T_B), // exists, not a member
      probe('GET', owner, UNKNOWN), // does not exist
      probe('GET', owner, T_SUSPENDED), // member of a suspended tenant
      probe('GET', former, T_A), // membership disabled
    ]);
    const bodies = answers.map((res) => {
      expect(res.statusCode).toBe(404);
      const { status, title, detail } = res.json();
      return { status, title, detail };
    });
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });

  it('answers 403 when the member role is not allowed', async () => {
    const exhibitor = await tokenFor('exhibitor@tenancy.test');
    const operator = await tokenFor('operator@tenancy.test');
    expect((await probe('GET', exhibitor, T_A)).statusCode).toBe(403);
    expect((await probe('POST', operator, T_A)).statusCode).toBe(403);
  });

  it('exposes the tenant and role to the handler', async () => {
    const res = await probe(
      'GET',
      await tokenFor('operator@tenancy.test'),
      T_A,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: T_A, role: 'OPERATOR' });
  });

  it('lets an allowed role act and audits it under its tenant', async () => {
    const res = await probe('POST', await tokenFor('owner@tenancy.test'), T_A);
    expect(res.statusCode).toBe(204);
    const { rows } = await database.withTenant(T_A, (tx) =>
      tx.execute(
        sql`SELECT tenant_id, actor_id, action FROM audit_logs WHERE action = 'probe.act'`,
      ),
    );
    expect(rows).toEqual([
      { tenant_id: T_A, actor_id: ownerId, action: 'probe.act' },
    ]);
  });
});

describe('audit log (CORE-03, §3.1 audit_logs)', () => {
  const entry = {
    actorId: null,
    action: 'venue.updated',
    entityType: 'venue',
    entityId: '99999999-9999-4999-8999-999999999999',
    before: { name: 'Viejo' },
    after: { name: 'Nuevo' },
  };

  it('records the entry with the tenant of the transaction', async () => {
    await database.withTenant(T_B, (tx) => audit.record(tx, entry));
    const { rows } = await database.withTenant(T_B, (tx) =>
      tx.execute(
        sql`SELECT tenant_id, entity_id, before_json, after_json FROM audit_logs WHERE action = 'venue.updated'`,
      ),
    );
    expect(rows).toEqual([
      {
        tenant_id: T_B,
        entity_id: entry.entityId,
        before_json: { name: 'Viejo' },
        after_json: { name: 'Nuevo' },
      },
    ]);
  });

  it('is invisible to other tenants and outside a tenant transaction', async () => {
    const fromA = await database.withTenant(T_A, (tx) =>
      tx.execute(sql`SELECT 1 FROM audit_logs WHERE action = 'venue.updated'`),
    );
    expect(fromA.rows).toEqual([]);
    const outside = await database.db.execute(sql`SELECT 1 FROM audit_logs`);
    expect(outside.rows).toEqual([]);
  });

  it('cannot be written outside a tenant transaction or for another tenant', async () => {
    await expect(
      database.db.transaction((tx) => audit.record(tx, entry)),
    ).rejects.toBeDefined();
    await expect(
      database.withTenant(T_A, (tx) =>
        tx.execute(
          sql`INSERT INTO audit_logs (tenant_id, action, entity_type) VALUES (${T_B}, 'forged', 'probe')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } }); // RLS WITH CHECK
  });

  it('is append-only for the application role', async () => {
    for (const statement of [
      sql`UPDATE audit_logs SET action = 'tampered'`,
      sql`DELETE FROM audit_logs`,
    ])
      await expect(
        database.withTenant(T_B, (tx) => tx.execute(statement)),
      ).rejects.toMatchObject({ cause: { code: '42501' } }); // insufficient_privilege
  });
});

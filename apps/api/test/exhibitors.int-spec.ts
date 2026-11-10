import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import { startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * EXH-01 against a real PostgreSQL: each exhibitor member owns its profile and its public consent
 * (Ley 25.326); organizers read the private data (D4 of org-ui-shell, INV-08); RLS isolation.
 */

const PASSWORD = 'exhibitors test password';
const X_A = 'abababab-abab-4bab-8bab-abababababab';
const X_B = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';

let app: NestFastifyApplication;
let database: DatabaseService;
const tokens = { owner: '', ana: '', beto: '' };

async function seed(): Promise<void> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    const hash = await hashPassword(PASSWORD);
    await client.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'exhibitors-a', 'Exhibitors A'), ($2, 'exhibitors-b', 'Exhibitors B')`,
      [X_A, X_B],
    );
    const { rows } = await client.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash) VALUES
         ('owner@exhibitors.test', $1), ('ana@exhibitors.test', $1), ('beto@exhibitors.test', $1)
       RETURNING id, email`,
      [hash],
    );
    const id = (email: string) => rows.find((r) => r.email === email)!.id;
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES
         ($1, $3, 'OWNER'), ($2, $3, 'OWNER'),
         ($1, $4, 'EXHIBITOR'), ($2, $4, 'EXHIBITOR'), ($1, $5, 'EXHIBITOR')`,
      [
        X_A,
        X_B,
        id('owner@exhibitors.test'),
        id('ana@exhibitors.test'),
        id('beto@exhibitors.test'),
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
  tokens.owner = await login('owner@exhibitors.test');
  tokens.ana = await login('ana@exhibitors.test');
  tokens.beto = await login('beto@exhibitors.test');
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

const call = (
  method: 'GET' | 'PUT',
  url: string,
  who: keyof typeof tokens,
  tenant = X_A,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${tokens[who]}`, 'x-tenant-id': tenant },
    ...(payload ? { payload } : {}),
  });

const perfil = {
  legalName: 'Lanas del Sur S.R.L.',
  tradeName: 'Lanas del Sur',
  taxId: '30-71234567-1',
  category: 'Textiles',
  description: 'Hilados artesanales de oveja y llama.',
  publicContactOptIn: false,
};

describe('exhibitor profile (EXH-01)', () => {
  let anaId = '';

  it('has no profile until the exhibitor creates it', async () => {
    expect((await call('GET', '/me/exhibitor-profile', 'ana')).statusCode).toBe(
      404,
    );
  });

  it('lets the exhibitor create its own profile (201) with a normalized CUIT', async () => {
    const res = await call('PUT', '/me/exhibitor-profile', 'ana', X_A, perfil);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      ...perfil,
      taxId: '30712345671',
      publicConsentAt: null,
    });
    anaId = res.json().id;
    expect(
      (await call('GET', '/me/exhibitor-profile', 'ana')).json(),
    ).toMatchObject({
      id: anaId,
      tradeName: 'Lanas del Sur',
    });
  });

  it('records when public consent is given and clears it when withdrawn', async () => {
    const given = await call('PUT', '/me/exhibitor-profile', 'ana', X_A, {
      ...perfil,
      publicContactOptIn: true,
    });
    expect(given.statusCode).toBe(200);
    expect(given.json()).toMatchObject({ id: anaId, publicContactOptIn: true });
    const consentAt = given.json().publicConsentAt;
    expect(consentAt).toEqual(expect.any(String));

    const again = await call('PUT', '/me/exhibitor-profile', 'ana', X_A, {
      ...perfil,
      publicContactOptIn: true,
      description: 'Otra descripción',
    });
    expect(again.json().publicConsentAt).toBe(consentAt); // still the original consent

    const withdrawn = await call(
      'PUT',
      '/me/exhibitor-profile',
      'ana',
      X_A,
      perfil,
    );
    expect(withdrawn.json()).toMatchObject({
      publicContactOptIn: false,
      publicConsentAt: null,
    });
  });

  it.each([
    ['an invalid CUIT', { taxId: '20-12345678-5' }],
    ['a blank trade name', { tradeName: '  ' }],
    ['a missing category', { category: undefined }],
    ['an owner field', { userId: '00000000-0000-4000-8000-000000000000' }],
    ['a consent that is not a boolean', { publicContactOptIn: 'yes' }],
  ])('rejects %s (400)', async (_case, change) => {
    const res = await call('PUT', '/me/exhibitor-profile', 'ana', X_A, {
      ...perfil,
      ...change,
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a profile without CUIT', async () => {
    const res = await call('PUT', '/me/exhibitor-profile', 'beto', X_A, {
      ...perfil,
      legalName: 'Beto Pérez',
      tradeName: 'Cerámicas Beto',
      taxId: null,
      category: 'Cerámica',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().taxId).toBeNull();
  });

  it('keeps one profile per organization: the same user starts empty in another tenant', async () => {
    expect(
      (await call('GET', '/me/exhibitor-profile', 'ana', X_B)).statusCode,
    ).toBe(404);
  });

  it('only exhibitor members have a profile; only managers list exhibitors', async () => {
    expect(
      (await call('GET', '/me/exhibitor-profile', 'owner')).statusCode,
    ).toBe(403);
    expect(
      (await call('PUT', '/me/exhibitor-profile', 'owner', X_A, perfil))
        .statusCode,
    ).toBe(403);
    expect((await call('GET', '/exhibitors', 'ana')).statusCode).toBe(403);
  });

  it('shows organizers the private data of their exhibitors (D4)', async () => {
    const res = await call('GET', '/exhibitors', 'owner');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({
        tradeName: 'Cerámicas Beto',
        taxId: null,
        documentsStatus: 'MISSING',
      }),
      expect.objectContaining({
        id: anaId,
        tradeName: 'Lanas del Sur',
        legalName: 'Lanas del Sur S.R.L.',
        taxId: '30712345671',
        category: 'Textiles',
        publicContactOptIn: false,
        documentsStatus: 'MISSING',
      }),
    ]);
    expect(
      (await call('GET', `/exhibitors/${anaId}`, 'owner')).json(),
    ).toMatchObject({ id: anaId });
  });

  it('hides exhibitors of other organizations (404 / empty list)', async () => {
    expect((await call('GET', '/exhibitors', 'owner', X_B)).json()).toEqual([]);
    expect(
      (await call('GET', `/exhibitors/${anaId}`, 'owner', X_B)).statusCode,
    ).toBe(404);
    expect((await call('GET', '/exhibitors/nope', 'owner')).statusCode).toBe(
      404,
    );
  });

  it('audits creation and updates of the profile', async () => {
    const { rows } = await database.withTenant(X_A, (tx) =>
      tx.execute(
        sql`SELECT action FROM audit_logs WHERE entity_id = ${anaId} ORDER BY created_at`,
      ),
    );
    expect(rows.map((r) => r.action)).toEqual([
      'exhibitor.created',
      'exhibitor.updated',
      'exhibitor.updated',
      'exhibitor.updated',
    ]);
  });

  it('keeps exhibitors invisible outside a tenant transaction (RLS)', async () => {
    const { rows } = await database.db.execute(sql`SELECT 1 FROM exhibitors`);
    expect(rows).toEqual([]);
  });
});

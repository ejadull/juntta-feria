import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import { ExhibitorDocumentsSweeper } from '../src/exhibitors/document-sweeper.service.js';
import { OBJECT_STORAGE } from '../src/storage/object-storage.js';
import { FakeObjectStorage } from './fake-object-storage.js';
import { startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * Unconfirmed uploads: a row whose `complete` never came (and the object the browser may have
 * PUT) is removed after DOCUMENT_UPLOAD_TTL_MINUTES; confirmed and recent ones stay.
 */

const PASSWORD = 'sweeper test password';
const S_A = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';
const S_B = '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b';
const TTL_MINUTES = 30;

let app: NestFastifyApplication;
let database: DatabaseService;
let sweeper: ExhibitorDocumentsSweeper;
const storage = new FakeObjectStorage();
const tokens = { ownera: '', anaa: '', ownerb: '', anab: '' };

async function seed(): Promise<void> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    const hash = await hashPassword(PASSWORD);
    await client.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'sweeper-a', 'Sweeper A'), ($2, 'sweeper-b', 'Sweeper B')`,
      [S_A, S_B],
    );
    const { rows } = await client.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash) VALUES
         ('ownera@sweeper.test', $1), ('anaa@sweeper.test', $1),
         ('ownerb@sweeper.test', $1), ('anab@sweeper.test', $1)
       RETURNING id, email`,
      [hash],
    );
    const id = (email: string) => rows.find((r) => r.email === email)!.id;
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES
         ($1, $3, 'OWNER'), ($1, $4, 'EXHIBITOR'), ($2, $5, 'OWNER'), ($2, $6, 'EXHIBITOR')`,
      [
        S_A,
        S_B,
        id('ownera@sweeper.test'),
        id('anaa@sweeper.test'),
        id('ownerb@sweeper.test'),
        id('anab@sweeper.test'),
      ],
    );
  } finally {
    await client.end();
  }
}

const call = (
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  who: keyof typeof tokens,
  tenant: string,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${tokens[who]}`, 'x-tenant-id': tenant },
    ...(payload ? { payload } : {}),
  });

async function profile(
  owner: keyof typeof tokens,
  exhibitor: keyof typeof tokens,
  tenant: string,
): Promise<void> {
  const category = await call('POST', '/exhibitor-categories', owner, tenant, {
    name: 'Rubro',
  });
  const res = await call('PUT', '/me/exhibitor-profile', exhibitor, tenant, {
    legalName: 'Feriante S.A.',
    tradeName: 'Feriante',
    categoryId: category.json().id,
    publicContactOptIn: false,
  });
  expect(res.statusCode).toBeLessThan(300);
}

const pdf = {
  type: 'CONSTANCIA_AFIP',
  fileName: 'constancia.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
};

/** A requested upload; `put` simulates the browser's PUT, `confirm` the `complete` call. */
async function request(
  who: 'anaa' | 'anab',
  tenant: string,
  { put = true, confirm = false, ageMinutes = 0 } = {},
) {
  const ticket = await call(
    'POST',
    '/exhibitors/me/documents',
    who,
    tenant,
    pdf,
  );
  expect(ticket.statusCode).toBe(201);
  const { document, upload } = ticket.json();
  const key = put
    ? storage.simulateUpload(upload.url, {
        sizeBytes: pdf.sizeBytes,
        contentType: pdf.contentType,
      })
    : storage.keyOf(upload.url);
  if (confirm)
    expect(
      (
        await call(
          'POST',
          `/exhibitors/me/documents/${document.id}/complete`,
          who,
          tenant,
        )
      ).statusCode,
    ).toBe(200);
  await database.withTenant(tenant, (tx) =>
    tx.execute(
      sql`UPDATE exhibitor_documents SET created_at = now() - make_interval(mins => ${ageMinutes}) WHERE id = ${document.id}`,
    ),
  );
  return { id: document.id as string, key };
}

const rowsOf = (tenant: string): Promise<string[]> =>
  database.withTenant(tenant, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(
      sql`SELECT id FROM exhibitor_documents`,
    );
    return rows.map((r) => r.id);
  });

beforeAll(async () => {
  await seed();
  app = await startIntApp([], [[OBJECT_STORAGE, storage]], {
    DOCUMENT_UPLOAD_TTL_MINUTES: String(TTL_MINUTES),
  });
  database = app.get(DatabaseService);
  sweeper = app.get(ExhibitorDocumentsSweeper);
  for (const who of Object.keys(tokens) as (keyof typeof tokens)[]) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: `${who}@sweeper.test`, password: PASSWORD },
    });
    tokens[who] = res.json().accessToken as string;
  }
  await profile('ownera', 'anaa', S_A);
  await profile('ownerb', 'anab', S_B);
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

describe('ExhibitorDocumentsSweeper', () => {
  it('removes old unconfirmed rows and objects, keeps recent and confirmed ones', async () => {
    const stale = await request('anaa', S_A, { ageMinutes: TTL_MINUTES + 5 });
    const neverPut = await request('anaa', S_A, {
      put: false,
      ageMinutes: 600,
    });
    const recent = await request('anaa', S_A, { ageMinutes: TTL_MINUTES - 5 });
    const confirmed = await request('anaa', S_A, {
      confirm: true,
      ageMinutes: 10_000,
    });

    const summary = await sweeper.run();

    expect(summary.deleted).toBeGreaterThanOrEqual(2);
    const left = await rowsOf(S_A);
    expect(left).not.toContain(stale.id);
    expect(left).not.toContain(neverPut.id);
    expect(left).toEqual(expect.arrayContaining([recent.id, confirmed.id]));
    expect(storage.objects.has(stale.key)).toBe(false);
    expect(storage.objects.has(recent.key)).toBe(true);
    expect(storage.objects.has(confirmed.key)).toBe(true);
  });

  it('is idempotent and survives an object that is already gone', async () => {
    const gone = await request('anaa', S_A, { ageMinutes: TTL_MINUTES + 1 });
    storage.objects.delete(gone.key);
    await expect(sweeper.run()).resolves.toMatchObject({ deleted: 1 });
    await expect(sweeper.run()).resolves.toMatchObject({ deleted: 0 });
    expect(await rowsOf(S_A)).not.toContain(gone.id);
  });

  it('records one audit entry per removed document, without storage keys', async () => {
    const stale = await request('anaa', S_A, { ageMinutes: TTL_MINUTES + 1 });
    await sweeper.run();
    const { rows } = await database.withTenant(S_A, (tx) =>
      tx.execute<{ before_json: unknown }>(
        sql`SELECT before_json FROM audit_logs WHERE action = 'exhibitor_document.upload_expired' AND entity_id = ${stale.id}`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].before_json)).not.toContain('tenants/');
  });

  it('sweeps one tenant at a time and never touches the others', async () => {
    const staleA = await request('anaa', S_A, { ageMinutes: TTL_MINUTES + 1 });
    const staleB = await request('anab', S_B, { ageMinutes: TTL_MINUTES + 1 });
    const confirmedB = await request('anab', S_B, {
      confirm: true,
      ageMinutes: 10_000,
    });

    await sweeper.sweepTenant(S_A);

    expect(await rowsOf(S_A)).not.toContain(staleA.id);
    expect(await rowsOf(S_B)).toEqual(
      expect.arrayContaining([staleB.id, confirmedB.id]),
    );
    expect(storage.objects.has(staleB.key)).toBe(true);

    await sweeper.run();
    expect(await rowsOf(S_B)).not.toContain(staleB.id);
    expect(await rowsOf(S_B)).toContain(confirmedB.id);
    expect(storage.objects.has(confirmedB.key)).toBe(true);
  });

  it('keeps the row when the storage fails, so the next sweep retries', async () => {
    const stale = await request('anaa', S_A, { ageMinutes: TTL_MINUTES + 1 });
    const remove = vi
      .spyOn(storage, 'remove')
      .mockRejectedValueOnce(new Error('storage down'));
    await expect(sweeper.run()).resolves.toMatchObject({ deleted: 0 });
    expect(await rowsOf(S_A)).toContain(stale.id);
    remove.mockRestore();
    await sweeper.run();
    expect(await rowsOf(S_A)).not.toContain(stale.id);
  });
});

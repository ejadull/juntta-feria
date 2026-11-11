import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import { OBJECT_STORAGE } from '../src/storage/object-storage.js';
import { FakeObjectStorage } from './fake-object-storage.js';
import { startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * EXH-03 against a real PostgreSQL with an in-memory storage: presign rules, confirmation by
 * HEAD, review, derived `documentsStatus`, download authorization and tenant isolation.
 */

const PASSWORD = 'documents test password';
const D_A = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';
const D_B = '4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d';
const MB = 1024 * 1024;

let app: NestFastifyApplication;
let database: DatabaseService;
const storage = new FakeObjectStorage();
const tokens = { owner: '', operator: '', ana: '', beto: '', ownerb: '' };
let anaId = '';
let betoId = '';

async function seed(): Promise<void> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    const hash = await hashPassword(PASSWORD);
    await client.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'documents-a', 'Documents A'), ($2, 'documents-b', 'Documents B')`,
      [D_A, D_B],
    );
    const { rows } = await client.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash) VALUES
         ('owner@documents.test', $1), ('operator@documents.test', $1), ('ana@documents.test', $1),
         ('beto@documents.test', $1), ('ownerb@documents.test', $1)
       RETURNING id, email`,
      [hash],
    );
    const id = (email: string) => rows.find((r) => r.email === email)!.id;
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES
         ($1, $3, 'OWNER'), ($1, $4, 'OPERATOR'), ($1, $5, 'EXHIBITOR'), ($1, $6, 'EXHIBITOR'),
         ($2, $7, 'OWNER')`,
      [
        D_A,
        D_B,
        id('owner@documents.test'),
        id('operator@documents.test'),
        id('ana@documents.test'),
        id('beto@documents.test'),
        id('ownerb@documents.test'),
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

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  who: keyof typeof tokens,
  tenant = D_A,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${tokens[who]}`, 'x-tenant-id': tenant },
    ...(payload ? { payload } : {}),
  });

async function createProfile(
  who: 'ana' | 'beto',
  name: string,
): Promise<string> {
  const category = await call('POST', '/exhibitor-categories', 'owner', D_A, {
    name: `Rubro ${name}`,
  });
  const res = await call('PUT', '/me/exhibitor-profile', who, D_A, {
    legalName: `${name} S.A.`,
    tradeName: name,
    categoryId: category.json().id,
    publicContactOptIn: false,
  });
  return res.json().id as string;
}

beforeAll(async () => {
  await seed();
  app = await startIntApp([], [[OBJECT_STORAGE, storage]]);
  database = app.get(DatabaseService);
  for (const who of Object.keys(tokens) as (keyof typeof tokens)[])
    tokens[who] = await login(`${who}@documents.test`);
  anaId = await createProfile('ana', 'Ana');
  betoId = await createProfile('beto', 'Beto');
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

const pdf = {
  type: 'CONSTANCIA_AFIP',
  fileName: 'constancia.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
};

/** Registers a document and "uploads" it to the fake storage, as the browser would. */
async function upload(
  who: 'ana' | 'beto' = 'ana',
  overrides: Partial<typeof pdf> = {},
) {
  const body = { ...pdf, ...overrides };
  const ticket = await call('POST', '/exhibitors/me/documents', who, D_A, body);
  expect(ticket.statusCode).toBe(201);
  const { document, upload: signed } = ticket.json();
  const key = storage.simulateUpload(signed.url, {
    sizeBytes: body.sizeBytes,
    contentType: body.contentType,
  });
  return { id: document.id as string, key, url: signed.url as string };
}

const complete = (who: 'ana' | 'beto', id: string) =>
  call('POST', `/exhibitors/me/documents/${id}/complete`, who);

const statusOf = async (exhibitor: string) =>
  (await call('GET', `/exhibitors/${exhibitor}`, 'owner')).json()
    .documentsStatus;

describe('requesting an upload (EXH-03)', () => {
  it('is for exhibitor members only', async () => {
    expect(
      (await call('POST', '/exhibitors/me/documents', 'ana', D_B, pdf))
        .statusCode,
    ).toBe(404); // ana is not a member of tenant B at all
    expect(
      (await call('GET', '/exhibitors/me/documents', 'owner')).statusCode,
    ).toBe(403);
  });

  it.each([
    ['a type outside the allow-list', { contentType: 'text/html' }],
    ['an executable', { contentType: 'application/x-msdownload' }],
    ['a file over 10 MB', { sizeBytes: 10 * MB + 1 }],
    ['an empty file', { sizeBytes: 0 }],
    ['a size that is not an integer', { sizeBytes: 10.5 }],
    ['an unknown document type', { type: 'PASAPORTE' }],
    ['a blank file name', { fileName: '  ' }],
    ['a storage field', { storageKey: 'tenants/x/y' }],
  ])('rejects %s (400) and signs nothing', async (_case, change) => {
    const before = storage.uploads.length;
    const res = await call('POST', '/exhibitors/me/documents', 'ana', D_A, {
      ...pdf,
      ...change,
    });
    expect(res.statusCode).toBe(400);
    expect(storage.uploads).toHaveLength(before);
  });

  it('signs a PUT for a server-chosen key under the tenant and exhibitor', async () => {
    const res = await call('POST', '/exhibitors/me/documents', 'ana', D_A, pdf);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.upload).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
    });
    expect(body.document).toMatchObject({
      type: 'CONSTANCIA_AFIP',
      status: 'PENDING',
      uploadedAt: null,
    });
    expect(JSON.stringify(body)).not.toContain('storageKey');
    const signed = storage.uploads.at(-1)!;
    expect(signed.key).toMatch(
      new RegExp(
        `^tenants/${D_A}/exhibitors/${anaId}/documents/[0-9a-f-]{36}$`,
      ),
    );
    expect(signed).toMatchObject({
      contentType: 'application/pdf',
      sizeBytes: 2048,
    });
    expect(signed.key.endsWith(body.document.id)).toBe(true);
  });

  it('does not list or count a document until the upload is confirmed', async () => {
    expect(
      (await call('GET', '/exhibitors/me/documents', 'ana')).json(),
    ).toEqual([]);
    expect(await statusOf(anaId)).toBe('MISSING');
    expect(
      (await call('GET', `/exhibitors/${anaId}/documents`, 'owner')).json(),
    ).toEqual([]);
  });
});

describe('confirming an upload', () => {
  it('answers 409 UPLOAD_MISSING while the object is not in the storage', async () => {
    const ticket = await call(
      'POST',
      '/exhibitors/me/documents',
      'beto',
      D_A,
      pdf,
    );
    const res = await complete('beto', ticket.json().document.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('UPLOAD_MISSING');
  });

  it('turns a real upload into a pending document (idempotent) and audits it', async () => {
    const doc = await upload('ana');
    const done = await complete('ana', doc.id);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({
      id: doc.id,
      status: 'PENDING',
      sizeBytes: 2048,
      fileName: 'constancia.pdf',
    });
    expect(done.json().uploadedAt).toEqual(expect.any(String));
    expect((await complete('ana', doc.id)).statusCode).toBe(200);
    expect(await statusOf(anaId)).toBe('PENDING');
    const { rows } = await database.withTenant(D_A, (tx) =>
      tx.execute(
        sql`SELECT action FROM audit_logs WHERE entity_id = ${doc.id}`,
      ),
    );
    expect(rows.map((r) => r.action)).toEqual(['exhibitor_document.uploaded']);
  });

  it('rejects an object over the limit or of another type, and removes it (422)', async () => {
    const big = await call(
      'POST',
      '/exhibitors/me/documents',
      'beto',
      D_A,
      pdf,
    );
    const bigKey = storage.simulateUpload(big.json().upload.url, {
      sizeBytes: 11 * MB,
      contentType: 'application/pdf',
    });
    const bigRes = await complete('beto', big.json().document.id);
    expect(bigRes.statusCode).toBe(422);
    expect(bigRes.json().code).toBe('UPLOAD_REJECTED');
    expect(storage.objects.has(bigKey)).toBe(false);

    const html = await call(
      'POST',
      '/exhibitors/me/documents',
      'beto',
      D_A,
      pdf,
    );
    storage.simulateUpload(html.json().upload.url, {
      sizeBytes: 100,
      contentType: 'text/html',
    });
    expect((await complete('beto', html.json().document.id)).statusCode).toBe(
      422,
    );
    expect(await statusOf(betoId)).toBe('MISSING');
  });

  it('cannot confirm the document of another exhibitor (404)', async () => {
    const doc = await upload('ana');
    expect((await complete('beto', doc.id)).statusCode).toBe(404);
  });
});

describe('download authorization', () => {
  let doc: { id: string; key: string };
  const staffUrl = (exhibitor = anaId) =>
    `/exhibitors/${exhibitor}/documents/${doc.id}/download`;

  beforeAll(async () => {
    doc = await upload('ana', { fileName: 'seguro.pdf', type: 'SEGURO' });
    await complete('ana', doc.id);
  });

  it('gives the owner a short-lived URL for its own key only', async () => {
    const res = await call(
      'GET',
      `/exhibitors/me/documents/${doc.id}/download`,
      'ana',
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      fileName: 'seguro.pdf',
      url: expect.stringContaining(doc.key),
    });
    expect(storage.downloads.at(-1)).toEqual({
      key: doc.key,
      expiresInSeconds: 60,
    });
  });

  it('gives organizers of the same tenant the same document', async () => {
    for (const who of ['owner', 'operator'] as const)
      expect((await call('GET', staffUrl(), who)).statusCode).toBe(200);
  });

  it('hides it from another exhibitor of the tenant (404) and from the staff routes (403)', async () => {
    expect(
      (await call('GET', `/exhibitors/me/documents/${doc.id}/download`, 'beto'))
        .statusCode,
    ).toBe(404);
    expect((await call('GET', staffUrl(), 'beto')).statusCode).toBe(403);
    expect(
      (await call('GET', `/exhibitors/${anaId}/documents`, 'beto')).statusCode,
    ).toBe(403);
  });

  it('hides it from another organization whatever ids or tenant it sends', async () => {
    expect((await call('GET', staffUrl(), 'ownerb', D_B)).statusCode).toBe(404);
    expect(
      (await call('GET', `/exhibitors/${anaId}/documents`, 'ownerb', D_B))
        .statusCode,
    ).toBe(404);
    expect((await call('GET', staffUrl(), 'ownerb', D_A)).statusCode).toBe(404);
  });

  it('does not sign a document through another exhibitor id or a malformed id', async () => {
    expect((await call('GET', staffUrl(betoId), 'owner')).statusCode).toBe(404);
    expect(
      (await call('GET', '/exhibitors/me/documents/not-a-uuid/download', 'ana'))
        .statusCode,
    ).toBe(404);
  });
});

describe('review and documentsStatus', () => {
  it('lists the exhibitor documents for organizers without storage keys', async () => {
    const list = await call(
      'GET',
      `/exhibitors/${anaId}/documents`,
      'operator',
    );
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(list.json())).not.toContain('tenants/');
  });

  it('only organizers review (403 for the exhibitor) and a rejection needs a reason', async () => {
    const doc = await upload('beto');
    await complete('beto', doc.id);
    const review = (who: keyof typeof tokens, body: object, tenant = D_A) =>
      call(
        'POST',
        `/exhibitors/${betoId}/documents/${doc.id}/review`,
        who,
        tenant,
        body,
      );

    expect((await review('beto', { decision: 'APPROVED' })).statusCode).toBe(
      403,
    );
    expect((await review('owner', { decision: 'REJECTED' })).statusCode).toBe(
      400,
    );
    expect(
      (await review('owner', { decision: 'REJECTED', reason: '  ' }))
        .statusCode,
    ).toBe(400);
    expect((await review('owner', { decision: 'MAYBE' })).statusCode).toBe(400);
    expect(
      (await review('ownerb', { decision: 'APPROVED' }, D_B)).statusCode,
    ).toBe(404);
    expect(await statusOf(betoId)).toBe('PENDING');

    const rejected = await review('operator', {
      decision: 'REJECTED',
      reason: 'La constancia está vencida',
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'La constancia está vencida',
    });
    expect(rejected.json().reviewedAt).toEqual(expect.any(String));
    expect(await statusOf(betoId)).toBe('REJECTED');
    // The exhibitor sees why.
    expect(
      (await call('GET', '/exhibitors/me/documents', 'beto')).json()[0],
    ).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'La constancia está vencida',
    });

    const approved = await review('owner', { decision: 'APPROVED' });
    expect(approved.json()).toMatchObject({
      status: 'APPROVED',
      rejectionReason: null,
    });
    expect(await statusOf(betoId)).toBe('APPROVED');

    const { rows } = await database.withTenant(D_A, (tx) =>
      tx.execute(
        sql`SELECT action FROM audit_logs WHERE entity_id = ${doc.id} ORDER BY created_at`,
      ),
    );
    expect(rows.map((r) => r.action)).toEqual([
      'exhibitor_document.uploaded',
      'exhibitor_document.rejected',
      'exhibitor_document.approved',
    ]);
  });

  it('derives MISSING / PENDING / REJECTED / APPROVED from the whole set', async () => {
    const summary = async (id: string) =>
      (
        (await call('GET', '/exhibitors', 'owner')).json() as {
          id: string;
          documentsStatus: string;
        }[]
      ).find((e) => e.id === id)?.documentsStatus;
    expect(await summary(betoId)).toBe('APPROVED');
    expect(await summary(anaId)).toBe('PENDING');
    // A second, pending document pulls an approved set back to PENDING.
    const extra = await upload('beto', { type: 'OTRO' });
    await complete('beto', extra.id);
    expect(await summary(betoId)).toBe('PENDING');
    // Any rejection wins.
    await call(
      'POST',
      `/exhibitors/${betoId}/documents/${extra.id}/review`,
      'owner',
      D_A,
      { decision: 'REJECTED', reason: 'Ilegible' },
    );
    expect(await summary(betoId)).toBe('REJECTED');
  });

  it('cannot review a document that was never confirmed (404)', async () => {
    const ticket = await call(
      'POST',
      '/exhibitors/me/documents',
      'ana',
      D_A,
      pdf,
    );
    const res = await call(
      'POST',
      `/exhibitors/${anaId}/documents/${ticket.json().document.id}/review`,
      'owner',
      D_A,
      { decision: 'APPROVED' },
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('deleting a document', () => {
  it('removes a pending document and its object (204) but keeps an approved one (409)', async () => {
    const doc = await upload('ana');
    await complete('ana', doc.id);
    expect(
      (await call('DELETE', `/exhibitors/me/documents/${doc.id}`, 'beto'))
        .statusCode,
    ).toBe(404);
    await call(
      'POST',
      `/exhibitors/${anaId}/documents/${doc.id}/review`,
      'owner',
      D_A,
      { decision: 'APPROVED' },
    );
    const blocked = await call(
      'DELETE',
      `/exhibitors/me/documents/${doc.id}`,
      'ana',
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('DOCUMENT_APPROVED');

    const other = await upload('ana');
    await complete('ana', other.id);
    expect(
      (await call('DELETE', `/exhibitors/me/documents/${other.id}`, 'ana'))
        .statusCode,
    ).toBe(204);
    expect(storage.objects.has(other.key)).toBe(false);
  });
});

describe('isolation in the database (RLS)', () => {
  it('keeps documents invisible outside a tenant transaction and across tenants', async () => {
    const outside = await database.db.execute(
      sql`SELECT 1 FROM exhibitor_documents`,
    );
    expect(outside.rows).toEqual([]);
    const other = await database.withTenant(D_B, (tx) =>
      tx.execute(sql`SELECT 1 FROM exhibitor_documents`),
    );
    expect(other.rows).toEqual([]);
  });
});

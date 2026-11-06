import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import { ORIGIN, startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * EXH-04 against a real PostgreSQL: one-time invitation links (also shared by WhatsApp) that
 * create a confirmed exhibitor account, revocation, expiry, and the registration log for admins.
 */

const PASSWORD = 'invitations test password';
const I_A = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
const I_B = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2';

let app: NestFastifyApplication;
let database: DatabaseService;
const tokens = { owner: '', operator: '' };

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
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'feria-norte', 'Feria Norte'), ($2, 'feria-sur', 'Feria Sur')`,
      [I_A, I_B],
    );
    const { rows } = await client.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash) VALUES
         ('owner@invitations.test', $1), ('operator@invitations.test', $1), ('ya@invitations.test', $1)
       RETURNING id, email`,
      [hash],
    );
    const id = (email: string) => rows.find((r) => r.email === email)!.id;
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $3, 'OWNER'), ($2, $3, 'OWNER'), ($1, $4, 'OPERATOR')`,
      [I_A, I_B, id('owner@invitations.test'), id('operator@invitations.test')],
    );
  });
}

async function login(email: string, password = PASSWORD) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
}

beforeAll(async () => {
  await seed();
  app = await startIntApp();
  database = app.get(DatabaseService);
  tokens.owner = (await login('owner@invitations.test')).json().accessToken;
  tokens.operator = (await login('operator@invitations.test')).json().accessToken;
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

const staff = (
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  who: keyof typeof tokens = 'operator',
  tenant = I_A,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${tokens[who]}`, 'x-tenant-id': tenant },
    ...(payload ? { payload } : {}),
  });

const anonymous = (method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, ...(payload ? { payload } : {}) });

const tokenOf = (url: string) => url.split('/').at(-1)!;

const cuenta = {
  fullName: 'Nora Feriante',
  email: 'nueva@invitations.test',
  password: 'una clave larga y segura',
  phone: '+54 9 11 2345-6789',
};

describe('exhibitor invitations (EXH-04)', () => {
  let invitationId = '';
  let token = '';

  it('creates a one-time link and a WhatsApp share link, shown only once', async () => {
    const res = await staff('POST', '/exhibitor-invitations', 'operator', I_A, {
      email: 'Nueva@Invitations.test',
      phone: '+54 9 11 2345-6789',
      name: 'Nora',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.url).toMatch(new RegExp(`^${ORIGIN}/invitacion/[A-Za-z0-9_-]{43}$`));
    expect(body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/5491123456789\?text=/);
    expect(decodeURIComponent(body.whatsappUrl)).toContain(body.url);
    expect(decodeURIComponent(body.whatsappUrl)).toContain('Feria Norte');
    const days = (Date.parse(body.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    invitationId = body.id;
    token = tokenOf(body.url);
  });

  it('rejects an invalid phone, email or validity (400)', async () => {
    for (const payload of [{ phone: '12' }, { email: 'no-es-email' }, { expiresInDays: 0 }, { expiresInDays: 31 }])
      expect((await staff('POST', '/exhibitor-invitations', 'operator', I_A, payload)).statusCode).toBe(400);
  });

  it('lists invitations of the organization without their links', async () => {
    const res = await staff('GET', '/exhibitor-invitations');
    expect(res.statusCode).toBe(200);
    const [invitation] = res.json();
    expect(invitation).toMatchObject({
      id: invitationId,
      status: 'PENDING',
      email: 'nueva@invitations.test',
      phone: '5491123456789',
      name: 'Nora',
    });
    expect(invitation).not.toHaveProperty('url');
    expect(invitation).not.toHaveProperty('tokenHash');
    expect((await staff('GET', '/exhibitor-invitations', 'owner', I_B)).json()).toEqual([]);
  });

  it('shows the invitation to anyone holding the link, and nothing for a wrong token', async () => {
    const res = await anonymous('GET', `/public/invitations/${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      organizationName: 'Feria Norte',
      email: 'nueva@invitations.test',
      name: 'Nora',
    });
    expect((await anonymous('GET', `/public/invitations/${'x'.repeat(43)}`)).statusCode).toBe(404);
  });

  it.each([
    ['a short password', { password: 'corta' }],
    ['a blank name', { fullName: ' ' }],
    ['another email than the invited one', { email: 'otra@invitations.test' }],
    ['an extra field', { role: 'OWNER' }],
  ])('refuses to accept with %s (400)', async (_case, change) => {
    const res = await anonymous('POST', `/public/invitations/${token}/accept`, { ...cuenta, ...change });
    expect(res.statusCode).toBe(400);
  });

  it('creates a confirmed exhibitor account that can sign in', async () => {
    const res = await anonymous('POST', `/public/invitations/${token}/accept`, cuenta);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ user: { email: 'nueva@invitations.test' }, tenantId: I_A });

    const session = await login('nueva@invitations.test', cuenta.password);
    expect(session.statusCode).toBe(200);
    expect(session.json().memberships).toEqual([
      expect.objectContaining({ tenantId: I_A, role: 'EXHIBITOR' }),
    ]);
    const { rows } = await owner((c) =>
      c.query(`SELECT full_name, phone, confirmed_at FROM users WHERE email = 'nueva@invitations.test'`),
    );
    expect(rows[0]).toMatchObject({ full_name: 'Nora Feriante', phone: '5491123456789' });
    expect(rows[0].confirmed_at).toBeInstanceOf(Date);
  });

  it('cannot be used twice', async () => {
    expect((await anonymous('GET', `/public/invitations/${token}`)).statusCode).toBe(404);
    const again = await anonymous('POST', `/public/invitations/${token}/accept`, cuenta);
    expect(again.statusCode).toBe(404);
    const [invitation] = (await staff('GET', '/exhibitor-invitations')).json();
    expect(invitation.status).toBe('ACCEPTED');
  });

  it('refuses an email that already has an account (409)', async () => {
    const created = await staff('POST', '/exhibitor-invitations', 'operator', I_A, { phone: '+54 11 5555-0000' });
    const res = await anonymous('POST', `/public/invitations/${tokenOf(created.json().url)}/accept`, {
      ...cuenta,
      email: 'YA@invitations.test',
    });
    expect(res.statusCode).toBe(409);
  });

  it('builds a WhatsApp share link without a phone too', async () => {
    const res = await staff('POST', '/exhibitor-invitations', 'operator', I_A, {});
    expect(res.json().whatsappUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it('lets managers revoke an invitation', async () => {
    const created = await staff('POST', '/exhibitor-invitations', 'operator', I_A, { name: 'Revocada' });
    const revoked = await staff('DELETE', `/exhibitor-invitations/${created.json().id}`);
    expect(revoked.statusCode).toBe(204);
    expect((await anonymous('GET', `/public/invitations/${tokenOf(created.json().url)}`)).statusCode).toBe(404);
    expect((await staff('DELETE', `/exhibitor-invitations/${created.json().id}`)).statusCode).toBe(409);
    expect((await staff('DELETE', `/exhibitor-invitations/${invitationId}`)).statusCode).toBe(409); // accepted
  });

  it('expires invitations', async () => {
    const created = await staff('POST', '/exhibitor-invitations', 'operator', I_A, { name: 'Vencida' });
    await owner((c) =>
      c.query(`UPDATE exhibitor_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
        created.json().id,
      ]),
    );
    expect((await anonymous('GET', `/public/invitations/${tokenOf(created.json().url)}`)).statusCode).toBe(404);
    const listed = (await staff('GET', '/exhibitor-invitations')).json();
    expect(listed.find((i: { id: string }) => i.id === created.json().id).status).toBe('EXPIRED');
  });

  it('shows admins the registration log; operators cannot read it', async () => {
    const res = await staff('GET', '/audit-logs?entityType=exhibitor_invitation', 'owner');
    expect(res.statusCode).toBe(200);
    const actions = res.json().map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['invitation.created', 'invitation.accepted', 'invitation.revoked']));
    const accepted = res.json().find((e: { action: string }) => e.action === 'invitation.accepted');
    expect(accepted).toMatchObject({ entityId: invitationId, actorEmail: 'nueva@invitations.test' });
    expect((await staff('GET', '/audit-logs', 'operator')).statusCode).toBe(403);
    expect((await staff('GET', '/audit-logs', 'owner', I_B)).json()).toEqual([]);
  });

  it('keeps invitations invisible outside a tenant transaction (RLS)', async () => {
    const { rows } = await database.db.execute(sql`SELECT 1 FROM exhibitor_invitations`);
    expect(rows).toEqual([]);
  });
});

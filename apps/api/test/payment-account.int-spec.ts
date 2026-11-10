import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import {
  OAUTH_CLIENT,
  type OAuthClient,
  type SellerTokens,
} from '../src/payments/mercadopago-oauth.js';
import { providerFailed } from '../src/payments/payment-provider.js';
import { SellerAccountsService } from '../src/payments/seller-accounts.service.js';
import { TokenCipher } from '../src/payments/token-cipher.js';
import { startIntApp, TOKEN_KEY } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * PAY-07 against a real PostgreSQL with a fake OAuth server: an admin links the organization's
 * Mercado Pago seller account (PKCE, state bound to tenant and user), tokens are stored sealed,
 * renewals are serialized per organization and secrets never reach the client.
 */

const PASSWORD = 'payment account test password';
const T = 'd7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7';
const OTHER = 'e8e8e8e8-e8e8-4e8e-8e8e-e8e8e8e8e8e8';
const DAY = 86_400_000;

/** In-memory OAuth server: issues rotating tokens and records what it received. */
class FakeOAuth implements OAuthClient {
  readonly exchanges: { code: string; verifier: string }[] = [];
  readonly refreshes: string[] = [];
  failRefresh = false;

  authorizationUrl(state: string, codeChallenge: string): string {
    return `https://auth.mp.test/authorization?${new URLSearchParams({ state, code_challenge: codeChallenge })}`;
  }

  exchange(code: string, verifier: string): Promise<SellerTokens> {
    this.exchanges.push({ code, verifier });
    return Promise.resolve(this.tokens('APP_USR-access-0', 'TG-refresh-0'));
  }

  async refresh(refreshToken: string): Promise<SellerTokens> {
    this.refreshes.push(refreshToken);
    if (this.failRefresh) throw providerFailed();
    await new Promise((resolve) => setTimeout(resolve, 50)); // widen the race window
    const n = this.refreshes.length;
    return this.tokens(`APP_USR-access-${n}`, `TG-refresh-${n}`);
  }

  private tokens(accessToken: string, refreshToken: string): SellerTokens {
    return {
      accessToken,
      refreshToken,
      expiresInSeconds: 15_552_000,
      sellerId: '987654',
      liveMode: false,
    };
  }
}

type Who = 'owner' | 'admin' | 'exhibitor';
const tokens = {} as Record<Who, string>;
const oauth = new FakeOAuth();
let app: NestFastifyApplication;
let database: DatabaseService;

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
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'account-a', 'Account A'), ($2, 'account-b', 'Account B')`,
      [T, OTHER],
    );
    for (const [who, role] of [
      ['owner', 'OWNER'],
      ['admin', 'ADMIN'],
      ['exhibitor', 'EXHIBITOR'],
    ] as const) {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, confirmed_at) VALUES ($1, $2, now()) RETURNING id`,
        [`${who}@account.test`, hash],
      );
      await c.query(
        `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)`,
        [T, rows[0].id, role],
      );
      if (who === 'owner')
        await c.query(
          `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
          [OTHER, rows[0].id],
        );
    }
  });
}

async function login(who: Who): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: `${who}@account.test`, password: PASSWORD },
  });
  return res.json().accessToken as string;
}

const call = (
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  who: Who,
  payload?: object,
  tenant = T,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${tokens[who]}`, 'x-tenant-id': tenant },
    ...(payload ? { payload } : {}),
  });

/** Starts the flow and returns the state the provider would send back to the redirect. */
const authorize = async (who: Who = 'owner', tenant = T) => {
  const res = await call(
    'POST',
    '/payment-account/authorization',
    who,
    undefined,
    tenant,
  );
  expect(res.statusCode).toBe(201);
  const url = new URL(res.json().authorizationUrl as string);
  return {
    state: url.searchParams.get('state')!,
    challenge: url.searchParams.get('code_challenge')!,
  };
};

const stored = async () =>
  (
    await owner((c) =>
      c.query<{
        access: string;
        refresh: string;
        key_id: string;
        seller_id: string;
      }>(
        `SELECT access_token_sealed AS access, refresh_token_sealed AS refresh, key_id, seller_id
         FROM seller_accounts WHERE tenant_id = $1`,
        [T],
      ),
    )
  ).rows;

const expiresIn = (ms: number) =>
  owner((c) =>
    c.query(`UPDATE seller_accounts SET expires_at = $2 WHERE tenant_id = $1`, [
      T,
      new Date(Date.now() + ms),
    ]),
  );

beforeAll(async () => {
  await seed();
  app = await startIntApp([], [[OAUTH_CLIENT, oauth]]);
  database = app.get(DatabaseService);
  for (const who of ['owner', 'admin', 'exhibitor'] as const)
    tokens[who] = await login(who);
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

describe('Mercado Pago seller account (PAY-07)', () => {
  it('shows an unlinked account and the environment to admins only', async () => {
    const res = await call('GET', '/payment-account', 'owner');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'NOT_LINKED',
      environment: 'sandbox',
      sellerId: null,
      liveMode: null,
      expiresAt: null,
      linkedAt: null,
    });
    expect(
      (await call('GET', '/payment-account', 'exhibitor')).statusCode,
    ).toBe(403);
    expect(
      (await call('POST', '/payment-account/authorization', 'exhibitor'))
        .statusCode,
    ).toBe(403);
  });

  it('links the account with PKCE and stores only sealed tokens', async () => {
    const { state, challenge } = await authorize();

    const res = await call('POST', '/payment-account/link', 'owner', {
      code: 'TG-code-1',
      state,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'LINKED',
      environment: 'sandbox',
      sellerId: '987654',
      liveMode: false,
    });
    expect(res.body).not.toMatch(/APP_USR|TG-refresh/);
    const [{ verifier }] = oauth.exchanges;
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      challenge,
    );
    expect(state).not.toContain(verifier);

    const [row] = await stored();
    expect(`${row.access} ${row.refresh}`).not.toMatch(/APP_USR|TG-refresh/);
    const cipher = new TokenCipher(TOKEN_KEY);
    expect(row.key_id).toBe(cipher.keyId);
    expect(cipher.open(row.access)).toBe('APP_USR-access-0');
    const audit = await database.withTenant(T, (tx) =>
      tx.execute(
        sql`SELECT after_json FROM audit_logs WHERE action = 'payment_account.linked'`,
      ),
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows)).not.toMatch(/APP_USR|TG-/);
  });

  it('refuses a tampered state, or one issued to another user or organization (400)', async () => {
    const { state } = await authorize();
    const tampered = `${state.slice(0, -2)}${state.endsWith('AA') ? 'BB' : 'AA'}`;
    for (const [who, payload, tenant] of [
      ['owner', { code: 'c', state: tampered }, T],
      ['admin', { code: 'c', state }, T],
      ['owner', { code: 'c', state }, OTHER],
    ] as const) {
      const res = await call(
        'POST',
        '/payment-account/link',
        who,
        payload,
        tenant,
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_OAUTH_STATE');
    }
    expect(oauth.exchanges).toHaveLength(1);
  });

  it('serves the stored token while it is far from expiring', async () => {
    const accounts = app.get(SellerAccountsService);
    expect(await accounts.accessToken(T)).toBe('APP_USR-access-0');
    expect(await accounts.accessToken(OTHER)).toBeNull();
    expect(oauth.refreshes).toHaveLength(0);
  });

  it('renews once for concurrent callers and keeps the rotated refresh token', async () => {
    await expiresIn(2 * DAY);
    const accounts = app.get(SellerAccountsService);

    const results = await Promise.all([
      accounts.accessToken(T),
      accounts.accessToken(T),
      accounts.accessToken(T),
    ]);

    expect(results).toEqual([
      'APP_USR-access-1',
      'APP_USR-access-1',
      'APP_USR-access-1',
    ]);
    expect(oauth.refreshes).toEqual(['TG-refresh-0']);
    expect(new TokenCipher(TOKEN_KEY).open((await stored())[0].refresh)).toBe(
      'TG-refresh-1',
    );
  });

  it('keeps a still-valid token when the renewal fails, and asks to relink once expired', async () => {
    const accounts = app.get(SellerAccountsService);
    oauth.failRefresh = true;
    await expiresIn(DAY);
    expect(await accounts.accessToken(T)).toBe('APP_USR-access-1');

    await expiresIn(-60_000);
    await expect(accounts.accessToken(T)).rejects.toMatchObject({
      status: 503,
    });
    expect((await call('GET', '/payment-account', 'owner')).json().status).toBe(
      'EXPIRED',
    );
    oauth.failRefresh = false;
  });

  it('relinks over an existing account and unlinks it', async () => {
    const { state } = await authorize('admin');
    expect(
      (
        await call('POST', '/payment-account/link', 'admin', {
          code: 'TG-code-2',
          state,
        })
      ).json().status,
    ).toBe('LINKED');
    expect(await stored()).toHaveLength(1);

    expect((await call('DELETE', '/payment-account', 'owner')).statusCode).toBe(
      204,
    );
    expect((await call('GET', '/payment-account', 'owner')).json().status).toBe(
      'NOT_LINKED',
    );
    expect(await app.get(SellerAccountsService).accessToken(T)).toBeNull();
  });

  it('keeps seller accounts invisible outside a tenant transaction (RLS)', async () => {
    const { rows } = await database.db.execute(
      sql`SELECT 1 FROM seller_accounts`,
    );
    expect(rows).toEqual([]);
  });
});

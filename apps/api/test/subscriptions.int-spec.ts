import { createHmac, randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { PAYMENT_PROVIDER } from '../src/payments/payment-provider.js';
import { FakePaymentProvider } from './fake-payment-provider.js';
import { ORIGIN, WEBHOOK_SECRET, startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * EXH-05 against a real PostgreSQL with a fake provider: the exhibitor subscribes to the PLATFORM
 * (preapproval), the signed webhook activates, renews, pauses or cancels it, and RES-01 only
 * lets an ACTIVE (or cancelled-but-paid) subscription reserve.
 */

const PASSWORD = 'subscription test password';
const T = '5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e';
const VENUE = '5f5f5f5f-5f5f-4f5f-8f5f-5f5f5f5f5f5f';
const DAY = 86_400_000;
const PRICE = 1_500_000;

type Who = 'owner' | 'ana' | 'beto' | 'gabi' | 'dani' | 'eli' | 'nina';
const PEOPLE: Who[] = ['owner', 'ana', 'beto', 'gabi', 'dani', 'eli', 'nina'];
const tokens = {} as Record<Who, string>;
const userIds = {} as Record<Who, string>;
const provider = new FakePaymentProvider();

let app: NestFastifyApplication;
let stands: Record<string, string> = {};

async function owner<R>(fn: (c: pg.Client) => Promise<R>): Promise<R> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Owner, five exhibitors with profile and CUIT but NO subscription, and a user without roles. */
async function seed(): Promise<void> {
  await owner(async (c) => {
    const hash = await hashPassword(PASSWORD);
    await c.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'subs-a', 'Subs A')`,
      [T],
    );
    await c.query(
      `INSERT INTO venues (id, tenant_id, type, name, timezone, width_m, height_m)
       VALUES ($1, $2, 'FIXED', 'Predio subs', 'America/Argentina/Buenos_Aires', 30, 20)`,
      [VENUE, T],
    );
    for (const who of PEOPLE) {
      const user = await c.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, confirmed_at) VALUES ($1, $2, now()) RETURNING id`,
        [`${who}@subs.test`, hash],
      );
      const id = user.rows[0].id;
      userIds[who] = id;
      if (who === 'nina') continue;
      await c.query(
        `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)`,
        [T, id, who === 'owner' ? 'OWNER' : 'EXHIBITOR'],
      );
      if (who === 'owner') continue;
      await c.query(
        `INSERT INTO exhibitors (tenant_id, user_id, legal_name, trade_name, tax_id, category)
         VALUES ($1, $2, $3, $3, '20123456786', 'Textiles')`,
        [T, id, `Feriante ${who}`],
      );
    }
  });
}

async function login(who: Who): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: `${who}@subs.test`, password: PASSWORD },
  });
  return res.json().accessToken as string;
}

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  who: Who,
  payload?: object,
  headers: Record<string, string> = {},
  target: NestFastifyApplication = app,
) =>
  target.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      authorization: `Bearer ${tokens[who]}`,
      'x-tenant-id': T,
      ...headers,
    },
    ...(payload ? { payload } : {}),
  });

const subscribe = (
  who: Who,
  payload: object = {},
  key: string = randomUUID(),
) => call('POST', '/me/subscription', who, payload, { 'idempotency-key': key });

const reserve = (who: Who, code: string) =>
  call(
    'POST',
    '/reservations',
    who,
    { eventStandId: stands[code], termsVersion: '2026-10-01' },
    { 'idempotency-key': randomUUID() },
  );

const sign = (dataId: string, requestId: string, secret = WEBHOOK_SECRET) => {
  const ts = Math.floor(Date.now() / 1000);
  const hash = createHmac('sha256', secret)
    .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
    .digest('hex');
  return `ts=${ts},v1=${hash}`;
};

interface Notify {
  topic?: string;
  tenant?: string;
  signature?: string | null;
}

const notify = (dataId: string, options: Notify = {}) => {
  const requestId = randomUUID();
  const { topic = 'subscription_preapproval', tenant } = options;
  const signature =
    options.signature === undefined
      ? sign(dataId, requestId)
      : options.signature;
  const query = new URLSearchParams({
    'data.id': dataId,
    type: topic,
    ...(tenant ? { tenant } : {}),
  });
  return {
    requestId,
    response: app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/mercadopago?${query}`,
      headers: {
        'x-request-id': requestId,
        ...(signature ? { 'x-signature': signature } : {}),
      },
      payload: { type: topic, data: { id: dataId } },
    }),
  };
};

/** The webhook answers 200 first and applies in-process: wait for the inbox row to settle. */
const settled = async (requestId: string) => {
  for (let i = 0; i < 100; i += 1) {
    const [found] = await owner(
      async (c) =>
        (
          await c.query<{ status: string; outcome: string | null }>(
            `SELECT status, outcome FROM payment_webhook_inbox WHERE request_id = $1`,
            [requestId],
          )
        ).rows,
    );
    if (found && found.status !== 'RECEIVED') return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Webhook was not processed.');
};

const deliver = async (dataId: string, options: Notify = {}) => {
  const { requestId, response } = notify(dataId, options);
  expect((await response).statusCode).toBe(200);
  return settled(requestId);
};

const row = async (who: Who) =>
  owner(async (c) => {
    const found = await c.query<{
      status: string;
      provider_subscription_id: string | null;
      current_period_end: Date | null;
      payer_email: string | null;
    }>(`SELECT * FROM platform_subscriptions WHERE user_id = $1`, [
      userIds[who],
    ]);
    return found.rows[0];
  });

/** Starts a subscription and has the payer authorize it, with the webhook in between. */
async function activate(who: Who, days = 30): Promise<string> {
  const started = await subscribe(who);
  expect([200, 201]).toContain(started.statusCode); // 200 when already pending
  const id = (await row(who)).provider_subscription_id as string;
  provider.updateSubscription(id, {
    status: 'authorized',
    nextPaymentDate: new Date(Date.now() + days * DAY),
  });
  expect((await deliver(id)).outcome).toBe('ACTIVATED');
  return id;
}

const rect = (x: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, 0],
      [x + 3, 0],
      [x + 3, 3],
      [x, 3],
      [x, 0],
    ],
  ],
});

beforeAll(async () => {
  await seed();
  app = await startIntApp([], [[PAYMENT_PROVIDER, provider]], {
    PLATFORM_SUBSCRIPTION_PRICE_CENTS: String(PRICE),
  });
  for (const who of PEOPLE) tokens[who] = await login(who);

  const template = await call('POST', '/layout-templates', 'owner', {
    name: 'Plano subs',
    venueId: VENUE,
  });
  const version = template.json().id;
  await call('PUT', `/layout-versions/${version}/objects`, 'owner', {
    objects: ['S1', 'S2', 'S3', 'S4'].map((code, i) => ({
      id: randomUUID(),
      kind: 'STAND',
      code,
      geometry: rect(i * 3),
      metadata: {},
    })),
  });
  await call('POST', `/layout-versions/${version}/publish`, 'owner');
  const now = Date.now();
  const created = await call('POST', '/events', 'owner', {
    venueId: VENUE,
    layoutVersionId: version,
    name: 'Feria subs',
    slug: 'feria-subs',
    salesOpenAt: new Date(now - DAY).toISOString(),
    salesCloseAt: new Date(now + 5 * DAY).toISOString(),
    startsAt: new Date(now + 6 * DAY).toISOString(),
    endsAt: new Date(now + 7 * DAY).toISOString(),
  });
  const eventId = created.json().id;
  const list: { id: string; code: string }[] = (
    await call('GET', `/events/${eventId}/stands`, 'owner')
  ).json();
  stands = Object.fromEntries(list.map((s) => [s.code, s.id]));
  await call('PATCH', `/events/${eventId}/stands`, 'owner', {
    standIds: Object.values(stands),
    priceCents: 500_000,
  });
  expect(
    (await call('POST', `/events/${eventId}/publish`, 'owner')).statusCode,
  ).toBe(200);
});

afterAll(async () => {
  await app.close();
});

describe('POST/GET/DELETE /me/subscription (EXH-05)', () => {
  it('reports NONE before subscribing', async () => {
    const res = await call('GET', '/me/subscription', 'ana');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'NONE' });
  });

  it('requires authentication, an Idempotency-Key and an exhibitor membership', async () => {
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/v1/me/subscription',
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await call('POST', '/me/subscription', 'ana', {})).statusCode).toBe(
      400,
    );
    const badEmail = await subscribe('ana', { payerEmail: 'not-an-email' });
    expect(badEmail.statusCode).toBe(400);
    const manager = await subscribe('owner');
    expect(manager.statusCode).toBe(403);
    expect(manager.json().code).toBe('EXHIBITOR_REQUIRED');
    const nobody = await subscribe('nina');
    expect(nobody.statusCode).toBe(403);
    expect(nobody.json().code).toBe('EXHIBITOR_REQUIRED');
    expect(provider.subscriptionRequests).toHaveLength(0);
  });

  it('starts a pending preapproval with the server price and the account email', async () => {
    const res = await subscribe('ana');

    expect(res.statusCode).toBe(201);
    const [request] = provider.subscriptionRequests;
    expect(request).toMatchObject({
      externalReference: userIds.ana,
      payerEmail: 'ana@subs.test',
      amountCents: PRICE,
      currency: 'ARS',
      backUrl: `${ORIGIN}/feriante/suscripcion`,
    });
    const stored = await row('ana');
    expect(stored.status).toBe('PENDING');
    expect(res.json()).toEqual({
      status: 'PENDING',
      initPoint: `https://sandbox.mp.test/subscriptions/${stored.provider_subscription_id}`,
      currentPeriodEnd: null,
    });
    expect((await call('GET', '/me/subscription', 'ana')).json()).toEqual(
      res.json(),
    );
  });

  it('answers a replay with the same pending preapproval (200), not a second one', async () => {
    const before = provider.subscriptionRequests.length;
    const first = await call('GET', '/me/subscription', 'ana');

    const again = await subscribe('ana');

    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect(provider.subscriptionRequests).toHaveLength(before);
  });

  it('does not let a pending subscription reserve', async () => {
    const res = await reserve('ana', 'S1');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('restarts with another payerEmail, cancelling the previous preapproval', async () => {
    const old = (await row('ana')).provider_subscription_id as string;

    const res = await subscribe('ana', { payerEmail: 'Comprador@Test.com' });

    expect(res.statusCode).toBe(201);
    expect(provider.cancelledSubscriptions).toContain(old);
    const stored = await row('ana');
    expect(stored.provider_subscription_id).not.toBe(old);
    expect(stored.payer_email).toBe('comprador@test.com');
    expect(provider.subscriptionRequests.at(-1)?.payerEmail).toBe(
      'comprador@test.com',
    );
  });

  it('keeps the pending row retryable when the provider fails, then completes it', async () => {
    provider.failNextSubscription();
    const failed = await subscribe('dani');
    expect(failed.statusCode).toBe(502);
    expect((await row('dani')).provider_subscription_id).toBeNull();

    const retried = await subscribe('dani');

    expect(retried.statusCode).toBe(201);
    expect(retried.json().initPoint).toMatch(/^https:\/\/sandbox\.mp\.test\//);
    const keys = provider.subscriptionRequests
      .filter((r) => r.externalReference === userIds.dani)
      .map((r) => r.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('activates on a signed subscription_preapproval notification and enables reserving', async () => {
    const id = await activate('ana');

    const stored = await row('ana');
    expect(stored.status).toBe('ACTIVE');
    expect(stored.current_period_end?.getTime()).toBeGreaterThan(
      Date.now() + 29 * DAY,
    );
    const status = (await call('GET', '/me/subscription', 'ana')).json();
    expect(status.status).toBe('ACTIVE');
    expect(status.initPoint).toBeUndefined();
    expect((await reserve('ana', 'S1')).statusCode).toBe(201);
    const again = await subscribe('ana');
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('SUBSCRIPTION_ALREADY_ACTIVE');
    expect(id).toBe(stored.provider_subscription_id);
  });

  it('extends the period when an authorized payment renews it', async () => {
    const id = (await row('ana')).provider_subscription_id as string;
    const next = new Date(Date.now() + 60 * DAY);
    provider.updateSubscription(id, { nextPaymentDate: next });
    provider.authorizedPayments.set('ap-1', {
      id: 'ap-1',
      preapprovalId: id,
      status: 'processed',
    });

    const outcome = await deliver('ap-1', {
      topic: 'subscription_authorized_payment',
    });

    expect(outcome.outcome).toBe('RENEWED');
    expect((await row('ana')).current_period_end?.getTime()).toBe(
      next.getTime(),
    );
  });

  it('leaves the subscription unchanged while the provider says pending', async () => {
    const started = await subscribe('eli');
    expect(started.statusCode).toBe(201);
    const id = (await row('eli')).provider_subscription_id as string;

    const outcome = await deliver(id);

    expect(outcome).toEqual({ status: 'PROCESSED', outcome: 'PENDING' });
    expect((await row('eli')).status).toBe('PENDING');
  });

  it('goes PAST_DUE when paused and blocks reserving', async () => {
    const id = await activate('gabi');
    provider.updateSubscription(id, { status: 'paused' });

    expect((await deliver(id)).outcome).toBe('PAST_DUE');

    expect((await row('gabi')).status).toBe('PAST_DUE');
    const res = await reserve('gabi', 'S3');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('becomes ACTIVE again when the provider resumes a paused preapproval', async () => {
    const id = (await row('gabi')).provider_subscription_id as string;
    provider.updateSubscription(id, {
      status: 'authorized',
      nextPaymentDate: new Date(Date.now() + 30 * DAY),
    });

    await deliver(id);

    expect((await row('gabi')).status).toBe('ACTIVE');
  });

  it('cancels at the provider and keeps the paid period', async () => {
    const id = await activate('beto');

    const res = await call('DELETE', '/me/subscription', 'beto');

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('CANCELLED');
    expect(provider.cancelledSubscriptions).toContain(id);
    expect((await row('beto')).status).toBe('CANCELLED');
    expect((await reserve('beto', 'S2')).statusCode).toBe(201);
    // Idempotent: a second DELETE does not call the provider again.
    const calls = provider.cancelledSubscriptions.length;
    expect((await call('DELETE', '/me/subscription', 'beto')).statusCode).toBe(
      200,
    );
    expect(provider.cancelledSubscriptions).toHaveLength(calls);
    // A late "authorized" event for the cancelled preapproval never reactivates it.
    provider.updateSubscription(id, { status: 'authorized' });
    expect((await deliver(id)).outcome).toBe('ALREADY_CANCELLED');
    expect((await row('beto')).status).toBe('CANCELLED');
  });

  it('refuses to cancel what does not exist and survives a provider failure on cancel', async () => {
    expect((await call('DELETE', '/me/subscription', 'nina')).statusCode).toBe(
      404,
    );
    await activate('dani');
    provider.failNextSubscription();
    const failed = await call('DELETE', '/me/subscription', 'dani');
    expect(failed.statusCode).toBe(502);
    expect((await row('dani')).status).toBe('ACTIVE');
  });

  it('marks a pending preapproval cancelled with no access', async () => {
    await owner((c) =>
      c.query(`DELETE FROM platform_subscriptions WHERE user_id = $1`, [
        userIds.eli,
      ]),
    );
    expect((await subscribe('eli')).statusCode).toBe(201);
    expect((await call('DELETE', '/me/subscription', 'eli')).statusCode).toBe(
      200,
    );
    const stored = await row('eli');
    expect(stored.status).toBe('CANCELLED');
    expect(stored.current_period_end).toBeNull();
    expect((await reserve('eli', 'S4')).json().code).toBe(
      'SUBSCRIPTION_REQUIRED',
    );
  });

  it('can subscribe again after cancelling', async () => {
    const res = await subscribe('eli');
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('PENDING');
  });
});

describe('subscription webhooks (EXH-05)', () => {
  it('rejects a bad or missing signature without processing anything', async () => {
    const id = (await row('eli')).provider_subscription_id as string;
    const bad = notify(id, { signature: sign(id, 'other-request') });
    const missing = notify(id, { signature: null });

    expect((await bad.response).statusCode).toBe(401);
    expect((await missing.response).statusCode).toBe(401);
    const stored = await owner(
      async (c) =>
        (
          await c.query(
            `SELECT 1 FROM payment_webhook_inbox WHERE request_id = ANY($1)`,
            [[bad.requestId, missing.requestId]],
          )
        ).rowCount,
    );
    expect(stored).toBe(0);
  });

  it('ignores a preapproval that is not ours', async () => {
    provider.subscriptions.set('preapproval-foreign', {
      id: 'preapproval-foreign',
      status: 'authorized',
      externalReference: 'something-else',
      initPoint: null,
      nextPaymentDate: new Date(Date.now() + DAY),
      payerEmail: null,
    });
    provider.subscriptions.set('preapproval-ghost', {
      id: 'preapproval-ghost',
      status: 'authorized',
      externalReference: randomUUID(),
      initPoint: null,
      nextPaymentDate: new Date(Date.now() + DAY),
      payerEmail: null,
    });

    for (const id of ['preapproval-foreign', 'preapproval-ghost'])
      expect(await deliver(id)).toEqual({
        status: 'IGNORED',
        outcome: 'UNKNOWN_SUBSCRIPTION',
      });
  });

  it('records a provider failure as FAILED for the reconciliation retry', async () => {
    const outcome = await deliver('preapproval-missing');
    expect(outcome).toEqual({ status: 'FAILED', outcome: 'PROVIDER_ERROR' });
    // The reconciliation job of other suites retries every FAILED row of the shared database.
    await owner((c) =>
      c.query(
        `UPDATE payment_webhook_inbox SET status = 'IGNORED' WHERE data_id = 'preapproval-missing'`,
      ),
    );
  });

  it('ignores a payment notification without a tenant hint: it is not a subscription topic', async () => {
    const { requestId, response } = notify('123', { topic: 'payment' });
    expect((await response).statusCode).toBe(200);
    expect(await settled(requestId)).toEqual({
      status: 'IGNORED',
      outcome: 'MISSING_TENANT',
    });
  });

  it('keeps ignoring unsupported topics', async () => {
    const { requestId, response } = notify('999', {
      topic: 'point_integration_wh',
    });
    expect((await response).statusCode).toBe(200);
    expect((await settled(requestId)).outcome).toBe('UNSUPPORTED_TOPIC');
  });
});

describe('subscription price not configured (EXH-05)', () => {
  it('answers 503 and creates nothing', async () => {
    // Stubbed variables outlive the first app: blank it so the price counts as unset.
    const bare = await startIntApp([], [[PAYMENT_PROVIDER, provider]], {
      PLATFORM_SUBSCRIPTION_PRICE_CENTS: '',
    });
    try {
      const before = provider.subscriptionRequests.length;
      const res = await call(
        'POST',
        '/me/subscription',
        'ana',
        {},
        { 'idempotency-key': randomUUID() },
        bare,
      );
      expect(res.statusCode).toBe(503);
      expect(provider.subscriptionRequests).toHaveLength(before);
    } finally {
      await bare.close();
    }
  });
});

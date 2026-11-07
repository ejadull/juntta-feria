import { createHmac, randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import { PAYMENT_PROVIDER } from '../src/payments/payment-provider.js';
import { ReconciliationService } from '../src/payments/reconciliation.service.js';
import { FakePaymentProvider } from './fake-payment-provider.js';
import { NOTIFICATION_URL, ORIGIN, WEBHOOK_SECRET, startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * PAY-02 against a real PostgreSQL with a fake provider: one idempotent payment attempt and one
 * preference per reservation, amount from the server snapshot (INV-05), the hold survives a
 * provider failure, and a reservation with a checkout is never released blindly (§6.6).
 */

const PASSWORD = 'checkout test password';
const T = 'c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4';
const VENUE = 'c5c5c5c5-c5c5-4c5c-8c5c-c5c5c5c5c5c5';
const DAY = 86_400_000;
const PRICE = 2_345_600;

type Who = 'owner' | 'ana' | 'beto' | 'gabi' | 'dani' | 'eli';
const PEOPLE: Who[] = ['owner', 'ana', 'beto', 'gabi', 'dani', 'eli'];
const tokens = {} as Record<Who, string>;
const provider = new FakePaymentProvider();

let app: NestFastifyApplication;
let database: DatabaseService;
let eventId = '';
let stands: Record<string, string> = {};

async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Owner plus three eligible exhibitors (confirmed, CUIT, active subscription). */
async function seed(): Promise<void> {
  await owner(async (c) => {
    const hash = await hashPassword(PASSWORD);
    await c.query(`INSERT INTO tenants (id, slug, name) VALUES ($1, 'checkout-a', 'Checkout A')`, [T]);
    await c.query(
      `INSERT INTO venues (id, tenant_id, type, name, timezone, width_m, height_m)
       VALUES ($1, $2, 'FIXED', 'Predio checkout', 'America/Argentina/Buenos_Aires', 30, 20)`,
      [VENUE, T],
    );
    for (const who of PEOPLE) {
      const user = await c.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, confirmed_at) VALUES ($1, $2, now()) RETURNING id`,
        [`${who}@checkout.test`, hash],
      );
      const id = user.rows[0].id;
      await c.query(`INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)`, [
        T,
        id,
        who === 'owner' ? 'OWNER' : 'EXHIBITOR',
      ]);
      if (who === 'owner') continue;
      await c.query(
        `INSERT INTO exhibitors (tenant_id, user_id, legal_name, trade_name, tax_id, category)
         VALUES ($1, $2, $3, $3, '20123456786', 'Textiles')`,
        [T, id, `Feriante ${who}`],
      );
      await c.query(
        `INSERT INTO platform_subscriptions (user_id, status, current_period_end) VALUES ($1, 'ACTIVE', $2)`,
        [id, new Date(Date.now() + 30 * DAY)],
      );
    }
  });
}

async function login(who: Who): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: `${who}@checkout.test`, password: PASSWORD },
  });
  return res.json().accessToken as string;
}

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  who: Who,
  payload?: object,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${tokens[who]}`, 'x-tenant-id': T, ...headers },
    ...(payload ? { payload } : {}),
  });

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

const hold = async (who: Who, code: string): Promise<string> => {
  const res = await call(
    'POST',
    '/reservations',
    who,
    { eventStandId: stands[code], termsVersion: '2026-10-01' },
    { 'idempotency-key': randomUUID() },
  );
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
};

const checkout = (who: Who, reservationId: string, key: string = randomUUID()) =>
  call('POST', `/reservations/${reservationId}/checkout`, who, undefined, { 'idempotency-key': key });

const setReservation = (reservationId: string, change: string) =>
  owner((c) => c.query(`UPDATE reservations SET ${change} WHERE id = $1`, [reservationId]));

beforeAll(async () => {
  await seed();
  app = await startIntApp([], [[PAYMENT_PROVIDER, provider]]);
  database = app.get(DatabaseService);
  for (const who of PEOPLE) tokens[who] = await login(who);

  const template = await call('POST', '/layout-templates', 'owner', { name: 'Plano checkout', venueId: VENUE });
  const version = template.json().id;
  await call('PUT', `/layout-versions/${version}/objects`, 'owner', {
    objects: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((code, i) => ({
      id: randomUUID(),
      kind: 'STAND',
      code,
      geometry: rect(i * 3),
      metadata: {},
    })),
  });
  expect((await call('POST', `/layout-versions/${version}/publish`, 'owner')).statusCode).toBe(200);
  const now = Date.now();
  const created = await call('POST', '/events', 'owner', {
    venueId: VENUE,
    layoutVersionId: version,
    name: 'Feria checkout',
    slug: 'feria-checkout',
    salesOpenAt: new Date(now - DAY).toISOString(),
    salesCloseAt: new Date(now + 5 * DAY).toISOString(),
    startsAt: new Date(now + 6 * DAY).toISOString(),
    endsAt: new Date(now + 7 * DAY).toISOString(),
  });
  eventId = created.json().id;
  const list: { id: string; code: string }[] = (await call('GET', `/events/${eventId}/stands`, 'owner')).json();
  stands = Object.fromEntries(list.map((s) => [s.code, s.id]));
  await call('PATCH', `/events/${eventId}/stands`, 'owner', { standIds: Object.values(stands), priceCents: PRICE });
  expect((await call('POST', `/events/${eventId}/publish`, 'owner')).statusCode).toBe(200);
}, 120_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

describe('checkout (PAY-02)', () => {
  let anaReservation = '';
  let anaKey = '';
  let anaAttempt = '';
  let anaUrl = '';

  it('creates a payment attempt and a preference from the reservation snapshot (201)', async () => {
    anaReservation = await hold('ana', 'C1');
    // The stand price changes after the hold: the checkout keeps the frozen one (INV-05).
    await call('PATCH', `/events/${eventId}/stands`, 'owner', { standIds: [stands.C1], priceCents: 1 });
    anaKey = randomUUID();

    const res = await checkout('ana', anaReservation, anaKey);

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({
      paymentAttemptId: expect.any(String),
      checkoutUrl: expect.stringMatching(/^https:\/\/sandbox\.mp\.test\/checkout\//),
      status: 'PENDING',
    });
    anaAttempt = body.paymentAttemptId;
    anaUrl = body.checkoutUrl;

    const [sent] = provider.checkouts.slice(-1);
    const reservation = (await call('GET', `/reservations/${anaReservation}`, 'ana')).json();
    expect(sent).toMatchObject({
      tenantId: T,
      externalReference: anaAttempt,
      amountCents: PRICE,
      currency: 'ARS',
      expiresAt: new Date(reservation.holdExpiresAt),
      notificationUrl: `${NOTIFICATION_URL}&tenant=${T}`,
      backUrls: {
        success: `${ORIGIN}/feriante/reservas/${anaReservation}/pago/aprobado`,
        pending: `${ORIGIN}/feriante/reservas/${anaReservation}/pago/pendiente`,
        failure: `${ORIGIN}/feriante/reservas/${anaReservation}/pago/rechazado`,
      },
    });
    expect(sent.title).toContain('C1');
    expect(reservation.status).toBe('PAYMENT_PENDING');
  });

  it('replays the checkout without a second preference, with the same or another key (200)', async () => {
    const calls = provider.checkouts.length;
    for (const key of [anaKey, randomUUID()]) {
      const res = await checkout('ana', anaReservation, key);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ paymentAttemptId: anaAttempt, checkoutUrl: anaUrl, status: 'PENDING' });
    }
    expect(provider.checkouts).toHaveLength(calls);
  });

  it('keeps the hold when the provider fails, and a retry completes the same attempt', async () => {
    const reservation = await hold('beto', 'C2');
    provider.failNext();

    const failed = await checkout('beto', reservation);
    expect(failed.statusCode).toBe(502);
    expect((await call('GET', `/reservations/${reservation}`, 'beto')).json().status).toBe('HELD');

    const retried = await checkout('beto', reservation);
    expect(retried.statusCode).toBe(201);
    const attempts = provider.checkouts.slice(-2).map((c) => c.externalReference);
    expect(attempts[0]).toBe(attempts[1]);
    expect(retried.json().paymentAttemptId).toBe(attempts[0]);
  });

  it('answers two concurrent checkouts with one attempt and one checkout URL', async () => {
    const reservation = await hold('gabi', 'C3');
    const [a, b] = await Promise.all([checkout('gabi', reservation), checkout('gabi', reservation)]);
    expect([a.statusCode, b.statusCode].sort((x, y) => x - y)).toEqual([200, 201]);
    expect(a.json()).toEqual(b.json());
  });

  it('never releases a reservation with a checkout when its hold expires (§6.6)', async () => {
    await setReservation(anaReservation, `hold_expires_at = now() - interval '1 second'`);
    expect((await call('GET', `/reservations/${anaReservation}`, 'ana')).json().status).toBe('PAYMENT_PENDING');
    const other = await call(
      'POST',
      '/reservations',
      'gabi',
      { eventStandId: stands.C1, termsVersion: '2026-10-01' },
      { 'idempotency-key': randomUUID() },
    );
    expect(other.statusCode).toBe(409);
    expect(other.json().code).toBe('STAND_UNAVAILABLE');
  });

  it('refuses a cancelled or expired hold (409 RESERVATION_NOT_PAYABLE)', async () => {
    await setReservation(anaReservation, `status = 'CANCELLED'`);
    const cancelled = await checkout('ana', anaReservation);
    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json().code).toBe('RESERVATION_NOT_PAYABLE');

    const expired = await hold('ana', 'C4');
    await setReservation(expired, `hold_expires_at = now() - interval '1 second'`);
    const res = await checkout('ana', expired);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('RESERVATION_NOT_PAYABLE');
  });

  it('only lets the reservation owner pay it', async () => {
    expect((await checkout('beto', anaReservation)).statusCode).toBe(404);
    expect((await checkout('owner', anaReservation)).statusCode).toBe(403);
    expect((await checkout('ana', 'not-a-uuid')).statusCode).toBe(404);
  });

  it('requires a UUID Idempotency-Key', async () => {
    const res = await call('POST', `/reservations/${anaReservation}/checkout`, 'ana');
    expect(res.statusCode).toBe(400);
  });

  it('allows a single pending attempt per reservation in the database', async () => {
    await expect(
      owner((c) =>
        c.query(
          `INSERT INTO payment_attempts (tenant_id, reservation_id, amount_cents, currency, expires_at, idempotency_key)
           SELECT tenant_id, reservation_id, amount_cents, currency, expires_at, gen_random_uuid()
           FROM payment_attempts WHERE id = $1`,
          [anaAttempt],
        ),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('audits the checkout', async () => {
    const { rows } = await database.withTenant(T, (tx) =>
      tx.execute(sql`SELECT action FROM audit_logs WHERE entity_type = 'payment_attempt'`),
    );
    expect(rows.map((r) => r.action)).toContain('payment_attempt.created');
  });

  it('keeps payment attempts invisible outside a tenant transaction (RLS)', async () => {
    const { rows } = await database.db.execute(sql`SELECT 1 FROM payment_attempts`);
    expect(rows).toEqual([]);
  });
});

/** Signs like Mercado Pago: HMAC-SHA256 over `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`. */
const sign = (dataId: string, requestId: string, secret = WEBHOOK_SECRET): string => {
  const ts = Math.floor(Date.now() / 1000);
  const hash = createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return `ts=${ts},v1=${hash}`;
};

interface Notify {
  requestId?: string;
  tenant?: string | null;
  topic?: string;
  signature?: string | null;
}

const notify = (dataId: string, options: Notify = {}) => {
  const { requestId = randomUUID(), tenant = T, topic = 'payment' } = options;
  const signature = options.signature === undefined ? sign(dataId, requestId) : options.signature;
  const query = new URLSearchParams({ 'data.id': dataId, type: topic, ...(tenant ? { tenant } : {}) });
  return {
    requestId,
    response: app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/mercadopago?${query}`,
      headers: { 'x-request-id': requestId, ...(signature ? { 'x-signature': signature } : {}) },
      payload: { type: topic, action: 'payment.updated', data: { id: dataId } },
    }),
  };
};

const inbox = async (requestId: string) =>
  (
    await owner((c) =>
      c.query<{ status: string; outcome: string | null }>(
        `SELECT status, outcome FROM payment_webhook_inbox WHERE request_id = $1`,
        [requestId],
      ),
    )
  ).rows;

/** Waits for the in-process handling that runs after the 200. */
const settled = (requestId: string) =>
  vi.waitFor(
    async () => {
      const [row] = await inbox(requestId);
      if (!row || row.status === 'RECEIVED') throw new Error('not processed yet');
      return row;
    },
    { timeout: 5_000, interval: 50 },
  );

/** The attempt and reservation of an exhibitor's checkout on a stand. */
const attemptOf = async (who: Who, code: string) =>
  (
    await owner((c) =>
      c.query<{ attemptId: string; reservationId: string; amount: string }>(
        `SELECT pa.id AS "attemptId", r.id AS "reservationId", pa.amount_cents AS amount
         FROM payment_attempts pa
         JOIN reservations r ON r.id = pa.reservation_id
         JOIN users u ON u.id = r.user_id
         JOIN event_stands s ON s.id = r.event_stand_id
         WHERE u.email = $1 AND s.code = $2`,
        [`${who}@checkout.test`, code],
      ),
    )
  ).rows[0];

const pay = (id: string, externalReference: string, status: string, amountCents = PRICE) =>
  provider.payments.set(id, {
    id,
    status,
    statusDetail: null,
    externalReference,
    amountCents,
    currency: 'ARS',
    collectorId: '1',
  });

const auditCount = async (action: string, entityId: string) =>
  (
    await owner((c) =>
      c.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND entity_id = $2`, [
        action,
        entityId,
      ]),
    )
  ).rows[0].n;

/** The notification whose payment could not be read; PAY-05 retries it. */
let failedRequestId = '';

describe('Mercado Pago webhooks (PAY-03)', () => {
  it('rejects a missing or invalid signature with 401 and stores nothing', async () => {
    const forged = notify('9001', { signature: sign('9001', 'other', 'not-the-secret') });
    expect((await forged.response).statusCode).toBe(401);
    const unsigned = notify('9001', { signature: null });
    expect((await unsigned.response).statusCode).toBe(401);
    expect(await inbox(forged.requestId)).toEqual([]);
    expect(await inbox(unsigned.requestId)).toEqual([]);
  });

  it('confirms the reservation and assigns the stand only after reading the payment', async () => {
    const beto = await attemptOf('beto', 'C2');
    pay('9100', beto.attemptId, 'approved');

    const { requestId, response } = notify('9100');
    expect((await response).statusCode).toBe(200);

    expect(await settled(requestId)).toEqual({ status: 'PROCESSED', outcome: 'CONFIRMED' });
    expect(provider.paymentReads.at(-1)).toEqual({ tenantId: T, paymentId: '9100' });
    expect((await call('GET', `/reservations/${beto.reservationId}`, 'beto')).json().status).toBe('CONFIRMED');
    const stand = (await call('GET', `/events/${eventId}/stands`, 'owner'))
      .json()
      .find((s: { code: string }) => s.code === 'C2');
    expect(stand.status).toBe('ASSIGNED');
  });

  it('has a single effect for duplicated notifications (AC-07)', async () => {
    const beto = await attemptOf('beto', 'C2');
    const first = notify('9100');
    await first.response;
    await settled(first.requestId);
    // Same x-request-id again: deduplicated by the inbox, never processed twice.
    expect((await notify('9100', { requestId: first.requestId }).response).statusCode).toBe(200);
    expect(await inbox(first.requestId)).toHaveLength(1);
    // A new x-request-id for the same approved payment is processed, but changes nothing.
    expect(await inbox(first.requestId)).toEqual([{ status: 'PROCESSED', outcome: 'ALREADY_APPROVED' }]);
    expect(await auditCount('reservation.confirmed', beto.reservationId)).toBe(1);
  });

  it('never reverts an approved payment with an older event (monotonic)', async () => {
    const beto = await attemptOf('beto', 'C2');
    pay('9100', beto.attemptId, 'pending');
    const { requestId, response } = notify('9100');
    await response;
    expect(await settled(requestId)).toMatchObject({ outcome: 'ALREADY_APPROVED' });
    expect((await call('GET', `/reservations/${beto.reservationId}`, 'beto')).json().status).toBe('CONFIRMED');
  });

  it('records a pending payment without confirming anything', async () => {
    const gabi = await attemptOf('gabi', 'C3');
    pay('9200', gabi.attemptId, 'in_process');
    const { requestId, response } = notify('9200');
    await response;
    expect(await settled(requestId)).toEqual({ status: 'PROCESSED', outcome: 'PAYMENT_IN_PROCESS' });
    expect((await call('GET', `/reservations/${gabi.reservationId}`, 'gabi')).json().status).toBe('PAYMENT_PENDING');
  });

  it('never confirms a payment whose amount differs from the snapshot (§6.7)', async () => {
    const gabi = await attemptOf('gabi', 'C3');
    pay('9201', gabi.attemptId, 'approved', PRICE - 100);
    const { requestId, response } = notify('9201');
    await response;
    expect(await settled(requestId)).toMatchObject({ outcome: 'AMOUNT_MISMATCH' });
    expect((await call('GET', `/reservations/${gabi.reservationId}`, 'gabi')).json().status).toBe('PAYMENT_PENDING');
    expect(await auditCount('payment.mismatch', gabi.attemptId)).toBe(1);
  });

  it('flags an approved payment of a cancelled reservation as LATE_PAYMENT_CONFLICT (INV-07)', async () => {
    const ana = await attemptOf('ana', 'C1');
    pay('9300', ana.attemptId, 'approved');
    const { requestId, response } = notify('9300');
    await response;
    expect(await settled(requestId)).toMatchObject({ outcome: 'LATE_PAYMENT_CONFLICT' });
    expect((await call('GET', `/reservations/${ana.reservationId}`, 'ana')).json().status).toBe('CANCELLED');
    expect(await auditCount('payment.late_conflict', ana.reservationId)).toBe(1);
  });

  it('acknowledges but ignores other topics, a missing tenant and foreign references', async () => {
    const order = notify('9400', { topic: 'merchant_order' });
    expect((await order.response).statusCode).toBe(200);
    expect(await inbox(order.requestId)).toEqual([{ status: 'IGNORED', outcome: 'UNSUPPORTED_TOPIC' }]);

    const anonymous = notify('9401', { tenant: null });
    expect((await anonymous.response).statusCode).toBe(200);
    expect(await inbox(anonymous.requestId)).toEqual([{ status: 'IGNORED', outcome: 'MISSING_TENANT' }]);

    pay('9402', randomUUID(), 'approved');
    const foreign = notify('9402');
    await foreign.response;
    expect(await settled(foreign.requestId)).toEqual({ status: 'IGNORED', outcome: 'UNKNOWN_ATTEMPT' });
  });

  it('answers 200 and records FAILED when the payment cannot be read', async () => {
    const { requestId, response } = notify('9999');
    failedRequestId = requestId;
    expect((await response).statusCode).toBe(200);
    expect(await settled(requestId)).toEqual({ status: 'FAILED', outcome: 'PROVIDER_ERROR' });
  });
});

const statusOf = async (who: Who, reservationId: string): Promise<string> =>
  (await call('GET', `/reservations/${reservationId}`, who)).json().status as string;

const minutesAgo = (minutes: number) => `hold_expires_at = now() - interval '${minutes} minutes'`;

describe('reconciliation (PAY-05)', () => {
  const reconcile = (now?: Date) => app.get(ReconciliationService).run(now);

  it('keeps an overdue checkout while the provider has a payment in flight', async () => {
    const gabi = await attemptOf('gabi', 'C3');
    await setReservation(gabi.reservationId, minutesAgo(10));
    provider.payments.delete('9201'); // only the in_process payment 9200 remains

    const summary = await reconcile();

    expect(summary.kept).toBeGreaterThanOrEqual(1);
    expect(await statusOf('gabi', gabi.reservationId)).toBe('PAYMENT_PENDING');
  });

  it('keeps it when an approved payment does not match the snapshot', async () => {
    const gabi = await attemptOf('gabi', 'C3');
    provider.payments.delete('9200');
    pay('9201', gabi.attemptId, 'approved', PRICE - 100);
    await reconcile();
    expect(await statusOf('gabi', gabi.reservationId)).toBe('PAYMENT_PENDING');
  });

  it('never releases it when the provider does not answer (§6.6)', async () => {
    const gabi = await attemptOf('gabi', 'C3');
    provider.payments.delete('9201');
    provider.failNext();
    const summary = await reconcile();
    expect(summary.unreachable).toBe(1);
    expect(await statusOf('gabi', gabi.reservationId)).toBe('PAYMENT_PENDING');
  });

  it('expires it only after the reconciliation window, freeing the stand', async () => {
    const gabi = await attemptOf('gabi', 'C3');
    await setReservation(gabi.reservationId, minutesAgo(1));

    await reconcile(); // 1 min past the hold: still inside the 5 min window
    expect(await statusOf('gabi', gabi.reservationId)).toBe('PAYMENT_PENDING');

    await reconcile(new Date(Date.now() + 10 * 60_000)); // controlled clock: past the window
    expect(await statusOf('gabi', gabi.reservationId)).toBe('EXPIRED');
    const [attempt] = (
      await owner((c) => c.query(`SELECT status FROM payment_attempts WHERE id = $1`, [gabi.attemptId]))
    ).rows;
    expect(attempt.status).toBe('EXPIRED');
    expect(await hold('dani', 'C3')).toBeTruthy(); // the stand is free again
  });

  it('confirms an approved payment that was never notified', async () => {
    const reservation = await hold('eli', 'C5');
    expect((await checkout('eli', reservation)).statusCode).toBe(201);
    const eli = await attemptOf('eli', 'C5');
    pay('9500', eli.attemptId, 'approved');
    await setReservation(reservation, minutesAgo(10));

    const summary = await reconcile();

    expect(summary.confirmed).toBe(1);
    expect(await statusOf('eli', reservation)).toBe('CONFIRMED');
  });

  it('retries a failed webhook until the payment can be read', async () => {
    const [before] = await inbox(failedRequestId);
    expect(before.status).toBe('FAILED');
    const reservation = await hold('ana', 'C6');
    expect((await checkout('ana', reservation)).statusCode).toBe(201);
    const ana = await attemptOf('ana', 'C6');
    pay('9999', ana.attemptId, 'approved');

    const summary = await reconcile();

    expect(summary.webhooksRetried).toBe(1);
    expect(await inbox(failedRequestId)).toEqual([{ status: 'PROCESSED', outcome: 'CONFIRMED' }]);
    expect(await statusOf('ana', reservation)).toBe('CONFIRMED');
  });

  it('is safe to run twice at once: one expiry, one audit entry', async () => {
    const dani = (
      await owner((c) =>
        c.query<{ id: string }>(
          `SELECT r.id FROM reservations r JOIN users u ON u.id = r.user_id
           WHERE u.email = 'dani@checkout.test' AND r.status = 'HELD'`,
        ),
      )
    ).rows[0].id;
    expect((await checkout('dani', dani)).statusCode).toBe(201);
    await setReservation(dani, minutesAgo(10));

    await Promise.all([reconcile(), reconcile()]);

    expect(await statusOf('dani', dani)).toBe('EXPIRED');
    expect(await auditCount('reservation.expired', dani)).toBe(1);
  });

  it('lists payment incidents for organization admins only (P10)', async () => {
    const res = await call('GET', '/payment-incidents', 'owner');
    expect(res.statusCode).toBe(200);
    const codes = res.json().map((i: { code: string }) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['LATE_PAYMENT_CONFLICT', 'AMOUNT_MISMATCH']));
    expect((await call('GET', '/payment-incidents', 'ana')).statusCode).toBe(403);
  });
});

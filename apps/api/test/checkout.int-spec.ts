import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import { PAYMENT_PROVIDER } from '../src/payments/payment-provider.js';
import { FakePaymentProvider } from './fake-payment-provider.js';
import { ORIGIN, startIntApp } from './int.app.js';
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

type Who = 'owner' | 'ana' | 'beto' | 'gabi';
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
    for (const who of ['owner', 'ana', 'beto', 'gabi'] as Who[]) {
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
  for (const who of ['owner', 'ana', 'beto', 'gabi'] as Who[]) tokens[who] = await login(who);

  const template = await call('POST', '/layout-templates', 'owner', { name: 'Plano checkout', venueId: VENUE });
  const version = template.json().id;
  await call('PUT', `/layout-versions/${version}/objects`, 'owner', {
    objects: ['C1', 'C2', 'C3', 'C4'].map((code, i) => ({
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

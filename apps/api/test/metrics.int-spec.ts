import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { startIntApp } from './int.app.js';
import {
  addExhibitor,
  addReservation,
  asOwner,
  createEvent,
  login,
  seedOrg,
  type FixtureEvent,
} from './event.fixture.js';

/**
 * REP-01 against a real PostgreSQL: occupancy by state, confirmed revenue, pending amount,
 * reservations per day, late-payment incidents; staff only and tenant-scoped.
 */

const M = {
  tenant: 'c1c1c1c1-6c6c-4c6c-8c6c-c1c1c1c1c1c1',
  venue: 'c2c2c2c2-6c6c-4c6c-8c6c-c2c2c2c2c2c2',
};
const N = {
  tenant: 'd1d1d1d1-6d6d-4d6d-8d6d-d1d1d1d1d1d1',
  venue: 'd2d2d2d2-6d6d-4d6d-8d6d-d2d2d2d2d2d2',
};
const DAY = 86_400_000;
const PRICE = 1_000_000;

let app: NestFastifyApplication;
let event: FixtureEvent;
const tokens = { owner: '', operator: '', exhibitor: '', foreign: '' };

const metrics = (who: keyof typeof tokens, id = event.id, query = '') =>
  app.inject({
    method: 'GET',
    url: `/api/v1/events/${id}/metrics${query}`,
    headers: {
      authorization: `Bearer ${tokens[who]}`,
      'x-tenant-id': who === 'foreign' ? N.tenant : M.tenant,
    },
  });

async function attempt(
  tenant: string,
  reservationId: string,
  status: 'APPROVED' | 'PENDING',
): Promise<void> {
  await asOwner((c) =>
    c.query(
      `INSERT INTO payment_attempts (tenant_id, reservation_id, status, amount_cents, currency, expires_at, idempotency_key)
       VALUES ($1, $2, $3, $4, 'ARS', now() + interval '1 hour', $5)`,
      [tenant, reservationId, status, PRICE, randomUUID()],
    ),
  );
}

beforeAll(async () => {
  const users = await seedOrg(M, 'metrics-a', 'Metrics A');
  await seedOrg(N, 'metrics-b', 'Metrics B');
  app = await startIntApp();
  tokens.owner = await login(app, 'owner@metrics-a.test');
  tokens.operator = await login(app, 'operator@metrics-a.test');
  tokens.exhibitor = await login(app, 'exhibitor@metrics-a.test');
  tokens.foreign = await login(app, 'owner@metrics-b.test');
  event = await createEvent(
    app,
    { token: tokens.owner, ...M },
    'metrics-feria',
  );

  const ana = await addExhibitor(M.tenant, users.exhibitor, {
    tradeName: 'Ana',
    consent: true,
  });
  const beto = await addExhibitor(M.tenant, users.operator, {
    tradeName: 'Beto',
    consent: false,
  });
  const gabi = await addExhibitor(M.tenant, users.owner, {
    tradeName: 'Gabi',
    consent: false,
  });
  const now = Date.now();
  // A1 confirmed and paid two days ago; A2 waiting for payment; A3 held; A4 free again after a refund.
  const paid = await addReservation(
    M.tenant,
    event.stands.A1,
    ana,
    users.exhibitor,
    'CONFIRMED',
    new Date(now - 2 * DAY),
  );
  await attempt(M.tenant, paid, 'APPROVED');
  const waiting = await addReservation(
    M.tenant,
    event.stands.A2,
    beto,
    users.operator,
    'PAYMENT_PENDING',
  );
  await attempt(M.tenant, waiting, 'PENDING');
  await addReservation(M.tenant, event.stands.A3, gabi, users.owner, 'HELD');
  const refunded = await addReservation(
    M.tenant,
    event.stands.A4,
    gabi,
    users.owner,
    'REFUNDED',
    new Date(now - 3 * DAY),
  );
  await attempt(M.tenant, refunded, 'APPROVED');
  await asOwner(async (c) => {
    await c.query(
      `INSERT INTO audit_logs (tenant_id, action, entity_type, entity_id, after_json)
       VALUES ($1, 'payment.late_conflict', 'reservation', $2, '{"code":"LATE_PAYMENT_CONFLICT"}')`,
      [M.tenant, paid],
    );
    // A late payment of ANOTHER reservation (not of this event) must not count here.
    await c.query(
      `INSERT INTO audit_logs (tenant_id, action, entity_type, entity_id)
       VALUES ($1, 'payment.late_conflict', 'reservation', $2)`,
      [M.tenant, randomUUID()],
    );
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

describe('event metrics (REP-01)', () => {
  it('counts stands by state (disabled stands are not inventory)', async () => {
    const res = await metrics('operator');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stands).toEqual({
      total: 5,
      available: 1,
      held: 1,
      pending: 1,
      confirmed: 1,
      blocked: 1,
    });
    expect(body).toMatchObject({
      eventId: event.id,
      eventName: 'Feria metrics-feria',
      venueName: 'Predio Metrics A',
      layoutVersionId: event.layoutVersionId,
      sellableStands: 5,
      blockedStands: 1,
      assignedStands: 1,
      currency: 'ARS',
      activeReservations: 2,
    });
    expect(body.startsAt).toMatch(/Z$/);
  });

  it('sums confirmed revenue only, and the amount still pending', async () => {
    const body = (await metrics('owner')).json();
    // The refunded reservation's approved payment is not revenue; the pending one is not either.
    expect(body.approvedGmvCents).toBe(PRICE);
    expect(body.gmvByMonth).toEqual([
      { month: new Date().toISOString().slice(0, 7), cents: PRICE },
    ]);
    expect(body.pendingAmountCents).toBe(2 * PRICE);
    expect(body.reconciliationPending).toBe(1);
  });

  it('counts reservations per day over the requested window, zero-filled', async () => {
    const body = (await metrics('operator', event.id, '?days=7')).json();
    const days = body.reservationsByDay as { day: string; count: number }[];
    expect(days).toHaveLength(7);
    const day = (ago: number) =>
      new Date(Date.now() - ago * DAY).toISOString().slice(0, 10);
    expect(days.map((d) => d.day)).toEqual(
      [6, 5, 4, 3, 2, 1, 0].map((ago) => day(ago)),
    );
    const byDay = Object.fromEntries(days.map((d) => [d.day, d.count]));
    expect(byDay[day(0)]).toBe(2);
    expect(byDay[day(2)]).toBe(1);
    expect(byDay[day(3)]).toBe(1);
    expect(byDay[day(1)]).toBe(0);
    expect((await metrics('operator')).json().reservationsByDay).toHaveLength(
      30,
    );
  });

  it('counts late-payment incidents of this event only', async () => {
    expect((await metrics('operator')).json().latePaymentIncidents).toBe(1);
  });

  it('breaks occupancy down by sector', async () => {
    const body = (await metrics('operator')).json();
    expect(body.occupancyBySector).toEqual([
      { sectorId: event.sectorId, name: 'Textil', sellable: 3, assigned: 1 },
      { sectorId: null, name: null, sellable: 2, assigned: 0 },
    ]);
  });

  it('is staff only: exhibitors get 403, anonymous 401', async () => {
    expect((await metrics('exhibitor')).statusCode).toBe(403);
    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/metrics`,
      headers: { 'x-tenant-id': M.tenant },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('is tenant-scoped: another organization sees a 404', async () => {
    expect((await metrics('foreign')).statusCode).toBe(404);
    expect((await metrics('operator', 'not-a-uuid')).statusCode).toBe(404);
    expect((await metrics('operator', randomUUID())).statusCode).toBe(404);
  });

  it('rejects a window outside 1..90 days', async () => {
    for (const days of ['0', '91', 'abc', '1.5'])
      expect(
        (await metrics('operator', event.id, `?days=${days}`)).statusCode,
      ).toBe(400);
  });
});

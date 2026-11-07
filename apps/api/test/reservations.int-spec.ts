import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import { startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * RES-01 against a real PostgreSQL: exhibitor eligibility (confirmed account, complete profile,
 * active platform subscription), sales window, holds with server clock, one active reservation
 * per stand under concurrency (INV-01), price snapshot (INV-05), idempotency and lazy expiry.
 */

const PASSWORD = 'reservations test password';
const R_A = 'a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9';
const VENUE = 'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0';
const DAY = 86_400_000;
const PRICE = 1_500_000;

type Who =
  'owner' | 'ana' | 'beto' | 'gabi' | 'carla' | 'dani' | 'eli' | 'fede';
const tokens = {} as Record<Who, string>;
const userIds = {} as Record<Who, string>;
const exhibitorIds = {} as Partial<Record<Who, string>>;

let app: NestFastifyApplication;
let database: DatabaseService;

async function owner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface Person {
  confirmed: boolean;
  profile: 'full' | 'no-cuit' | null;
  subscription: 'active' | 'expired' | null;
}

/** Exhibitors with every combination of eligibility the rules care about. */
const PEOPLE: Record<Exclude<Who, 'owner'>, Person> = {
  ana: { confirmed: true, profile: 'full', subscription: 'active' },
  beto: { confirmed: true, profile: 'full', subscription: 'active' },
  gabi: { confirmed: true, profile: 'full', subscription: 'active' },
  carla: { confirmed: false, profile: 'full', subscription: 'active' },
  dani: { confirmed: true, profile: null, subscription: 'active' },
  eli: { confirmed: true, profile: 'no-cuit', subscription: 'active' },
  fede: { confirmed: true, profile: 'full', subscription: 'expired' },
};

async function seed(): Promise<void> {
  await owner(async (c) => {
    const hash = await hashPassword(PASSWORD);
    await c.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'reservas-a', 'Reservas A')`,
      [R_A],
    );
    await c.query(
      `INSERT INTO venues (id, tenant_id, type, name, timezone, width_m, height_m)
       VALUES ($1, $2, 'FIXED', 'Predio reservas', 'America/Argentina/Buenos_Aires', 30, 20)`,
      [VENUE, R_A],
    );
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, confirmed_at) VALUES ('owner@reservations.test', $1, now()) RETURNING id`,
      [hash],
    );
    userIds.owner = rows[0].id;
    await c.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [R_A, userIds.owner],
    );

    for (const [who, p] of Object.entries(PEOPLE) as [
      Exclude<Who, 'owner'>,
      Person,
    ][]) {
      const user = await c.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, confirmed_at) VALUES ($1, $2, $3) RETURNING id`,
        [`${who}@reservations.test`, hash, p.confirmed ? new Date() : null],
      );
      userIds[who] = user.rows[0].id;
      await c.query(
        `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'EXHIBITOR')`,
        [R_A, userIds[who]],
      );
      if (p.profile) {
        const ex = await c.query<{ id: string }>(
          `INSERT INTO exhibitors (tenant_id, user_id, legal_name, trade_name, tax_id, category)
           VALUES ($1, $2, $3, $3, $4, 'Textiles') RETURNING id`,
          [
            R_A,
            userIds[who],
            `Feriante ${who}`,
            p.profile === 'full' ? '20123456786' : null,
          ],
        );
        exhibitorIds[who] = ex.rows[0].id;
      }
      if (p.subscription)
        await c.query(
          `INSERT INTO platform_subscriptions (user_id, status, current_period_end) VALUES ($1, 'ACTIVE', $2)`,
          [
            userIds[who],
            new Date(
              Date.now() + (p.subscription === 'active' ? 30 : -1) * DAY,
            ),
          ],
        );
    }
  });
}

async function login(who: Who): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: `${who}@reservations.test`, password: PASSWORD },
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
    headers: {
      authorization: `Bearer ${tokens[who]}`,
      'x-tenant-id': R_A,
      ...headers,
    },
    ...(payload ? { payload } : {}),
  });

const rect = (x: number, y: number, w: number, h: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y],
    ],
  ],
});

type Stand = { id: string; code: string };
interface OpenEvent {
  id: string;
  stands: Record<string, Stand>;
}

/** Published event with A1/A2 priced and A3 disabled; `salesOpenAt` relative to now. */
async function event(
  slug: string,
  layoutVersionId: string,
  salesOpenInDays: number,
): Promise<OpenEvent> {
  const now = Date.now();
  const created = await call('POST', '/events', 'owner', {
    venueId: VENUE,
    layoutVersionId,
    name: slug,
    slug,
    salesOpenAt: new Date(now + salesOpenInDays * DAY).toISOString(),
    salesCloseAt: new Date(now + 5 * DAY).toISOString(),
    startsAt: new Date(now + 6 * DAY).toISOString(),
    endsAt: new Date(now + 7 * DAY).toISOString(),
  });
  expect(created.statusCode).toBe(201);
  const id = created.json().id;
  const list: Stand[] = (
    await call('GET', `/events/${id}/stands`, 'owner')
  ).json();
  const stands = Object.fromEntries(list.map((s) => [s.code, s]));
  await call('PATCH', `/events/${id}/stands`, 'owner', {
    standIds: [stands.A1.id, stands.A2.id],
    priceCents: PRICE,
  });
  await call('PATCH', `/events/${id}/stands`, 'owner', {
    standIds: [stands.A3.id],
    status: 'DISABLED',
  });
  expect(
    (await call('POST', `/events/${id}/publish`, 'owner')).statusCode,
  ).toBe(200);
  return { id, stands };
}

let open: OpenEvent;
let race: OpenEvent;
let closed: OpenEvent;

beforeAll(async () => {
  await seed();
  app = await startIntApp();
  database = app.get(DatabaseService);
  for (const who of ['owner', ...Object.keys(PEOPLE)] as Who[])
    tokens[who] = await login(who);

  const template = await call('POST', '/layout-templates', 'owner', {
    name: 'Plano reservas',
    venueId: VENUE,
  });
  const version = template.json().id;
  await call('PUT', `/layout-versions/${version}/objects`, 'owner', {
    objects: ['A1', 'A2', 'A3'].map((code, i) => ({
      id: randomUUID(),
      kind: 'STAND',
      code,
      geometry: rect(i * 3, 0, 3, 3),
      metadata: {},
    })),
  });
  expect(
    (await call('POST', `/layout-versions/${version}/publish`, 'owner'))
      .statusCode,
  ).toBe(200);
  open = await event('reservas-abiertas', version, -1);
  race = await event('reservas-carrera', version, -1);
  closed = await event('reservas-cerradas', version, 1);
}, 120_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

const reserve = (
  who: Who,
  standId: string,
  key: string = randomUUID(),
  extra: object = {},
) =>
  call(
    'POST',
    '/reservations',
    who,
    { eventStandId: standId, termsVersion: '2026-10-01', ...extra },
    { 'idempotency-key': key },
  );

describe('reservations (RES-01)', () => {
  let anaKey = '';
  let anaReservation = '';

  it('holds a stand for an eligible exhibitor with a frozen price and the server clock', async () => {
    anaKey = randomUUID();
    const res = await reserve('ana', open.stands.A1.id, anaKey);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      status: 'HELD',
      amount: { currency: 'ARS', valueCents: PRICE },
      stand: { id: open.stands.A1.id, code: 'A1', areaM2: 9 },
      eventId: open.id,
      exhibitorId: exhibitorIds.ana,
      termsVersion: '2026-10-01',
    });
    const minutes = (Date.parse(body.holdExpiresAt) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
    anaReservation = body.id;
  });

  it('replays the same Idempotency-Key, and refuses it for a different request', async () => {
    const replay = await reserve('ana', open.stands.A1.id, anaKey);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(anaReservation);
    const reused = await reserve('ana', open.stands.A2.id, anaKey);
    expect(reused.statusCode).toBe(422);
    expect(reused.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('requires a UUID Idempotency-Key', async () => {
    const missing = await call('POST', '/reservations', 'ana', {
      eventStandId: open.stands.A2.id,
      termsVersion: 'v1',
    });
    expect(missing.statusCode).toBe(400);
    expect(
      (await reserve('ana', open.stands.A2.id, 'not-a-uuid')).statusCode,
    ).toBe(400);
  });

  it('refuses a stand someone else holds (409 STAND_UNAVAILABLE)', async () => {
    const res = await reserve('beto', open.stands.A1.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('STAND_UNAVAILABLE');
  });

  it('allows one active hold per exhibitor and event (409 HOLD_LIMIT)', async () => {
    const res = await reserve('ana', open.stands.A2.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('HOLD_LIMIT');
  });

  it('lets exactly one of two concurrent exhibitors hold the same stand (INV-01)', async () => {
    const results = await Promise.all([
      reserve('ana', race.stands.A1.id),
      reserve('gabi', race.stands.A1.id),
    ]);
    expect(results.map((r) => r.statusCode).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
  });

  it.each([
    ['carla', 'ACCOUNT_NOT_CONFIRMED'],
    ['dani', 'PROFILE_INCOMPLETE'],
    ['eli', 'PROFILE_INCOMPLETE'],
    ['fede', 'SUBSCRIPTION_REQUIRED'],
  ] as const)('refuses %s with 403 %s', async (who, code) => {
    const res = await reserve(who, open.stands.A2.id);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe(code);
  });

  it('refuses closed sales (422), disabled and unknown stands, and organizer roles', async () => {
    const sales = await reserve('beto', closed.stands.A1.id);
    expect(sales.statusCode).toBe(422);
    expect(sales.json().code).toBe('EVENT_SALES_CLOSED');
    const disabled = await reserve('beto', open.stands.A3.id);
    expect(disabled.statusCode).toBe(409);
    expect(disabled.json().code).toBe('STAND_UNAVAILABLE');
    expect((await reserve('beto', randomUUID())).statusCode).toBe(404);
    expect((await reserve('owner', open.stands.A2.id)).statusCode).toBe(403);
  });

  it('refuses to reserve for another exhibitor (403 EXHIBITOR_NOT_AUTHORIZED)', async () => {
    const res = await reserve('beto', open.stands.A2.id, randomUUID(), {
      exhibitorId: exhibitorIds.ana,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('EXHIBITOR_NOT_AUTHORIZED');
  });

  it('shows an expired hold as EXPIRED and frees the stand for the next exhibitor', async () => {
    await owner((c) =>
      c.query(
        `UPDATE reservations SET hold_expires_at = now() - interval '1 second' WHERE id = $1`,
        [anaReservation],
      ),
    );
    expect(
      (await call('GET', `/reservations/${anaReservation}`, 'ana')).json()
        .status,
    ).toBe('EXPIRED');
    const res = await reserve('beto', open.stands.A1.id);
    expect(res.statusCode).toBe(201);
    const { rows } = await owner((c) =>
      c.query(`SELECT status FROM reservations WHERE id = $1`, [
        anaReservation,
      ]),
    );
    expect(rows[0].status).toBe('EXPIRED');
  });

  it('lets each exhibitor read only its reservations; organizers read them all', async () => {
    expect(
      (await call('GET', `/reservations/${anaReservation}`, 'beto')).statusCode,
    ).toBe(404);
    expect(
      (await call('GET', `/reservations/${anaReservation}`, 'owner'))
        .statusCode,
    ).toBe(200);
    const mine = (await call('GET', '/reservations', 'ana')).json();
    expect(
      mine.every(
        (r: { exhibitorId: string }) => r.exhibitorId === exhibitorIds.ana,
      ),
    ).toBe(true);
    const all = (
      await call('GET', `/reservations?eventId=${open.id}`, 'owner')
    ).json();
    expect(
      new Set(all.map((r: { exhibitorId: string }) => r.exhibitorId)),
    ).toEqual(new Set([exhibitorIds.ana, exhibitorIds.beto]));
  });

  it('cancels a hold (owner of the reservation or organizer); a cancelled one cannot be cancelled again', async () => {
    const mine = (
      await call('GET', `/reservations?eventId=${open.id}`, 'beto')
    ).json()[0];
    const res = await call('POST', `/reservations/${mine.id}/cancel`, 'beto');
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('CANCELLED');
    expect(
      (await call('POST', `/reservations/${mine.id}/cancel`, 'beto'))
        .statusCode,
    ).toBe(409);
    expect((await reserve('gabi', open.stands.A1.id)).statusCode).toBe(201); // freed
    const gabis = (
      await call('GET', `/reservations?eventId=${open.id}`, 'gabi')
    ).json()[0];
    expect(
      (await call('POST', `/reservations/${gabis.id}/cancel`, 'owner'))
        .statusCode,
    ).toBe(200);
  });

  it('enforces one active reservation per stand in the database (INV-01)', async () => {
    const stand = race.stands.A1.id;
    await expect(
      database.withTenant(R_A, (tx) =>
        tx.execute(sql`INSERT INTO reservations (event_stand_id, exhibitor_id, user_id, status, hold_expires_at, price_cents, currency, terms_version, idempotency_key)
          VALUES (${stand}, ${exhibitorIds.beto}, ${userIds.beto}, 'HELD', now() + interval '10 minutes', 1, 'ARS', 'v1', ${randomUUID()})`),
      ),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('audits holds and cancellations', async () => {
    const { rows } = await database.withTenant(R_A, (tx) =>
      tx.execute(
        sql`SELECT action FROM audit_logs WHERE entity_type = 'reservation'`,
      ),
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'reservation.held',
        'reservation.expired',
        'reservation.cancelled',
      ]),
    );
  });

  it('keeps reservations invisible outside a tenant transaction (RLS)', async () => {
    const { rows } = await database.db.execute(sql`SELECT 1 FROM reservations`);
    expect(rows).toEqual([]);
  });
});

import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import { startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * EVT-01 against a real PostgreSQL: events on a published layout (INV-03), stands generated from
 * its STAND objects, priced inventory, sectors per event (ADR 0002, INV-09), publish rules and RLS.
 */

const PASSWORD = 'events test password';
const E_A = 'b8b8b8b8-b8b8-4b8b-8b8b-b8b8b8b8b8b8';
const E_B = 'c9c9c9c9-c9c9-4c9c-8c9c-c9c9c9c9c9c9';
const VENUE = 'dadadada-dada-4ada-8ada-dadadadadada';

let app: NestFastifyApplication;
let database: DatabaseService;
const tokens = { owner: '', operator: '' };

async function seed(): Promise<void> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    const hash = await hashPassword(PASSWORD);
    await client.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'events-a', 'Events A'), ($2, 'events-b', 'Events B')`,
      [E_A, E_B],
    );
    await client.query(
      `INSERT INTO venues (id, tenant_id, type, name, timezone, width_m, height_m)
       VALUES ($1, $2, 'FIXED', 'Predio eventos', 'America/Argentina/Buenos_Aires', 30, 20)`,
      [VENUE, E_A],
    );
    const { rows } = await client.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash) VALUES ('owner@events.test', $1), ('operator@events.test', $1)
       RETURNING id, email`,
      [hash],
    );
    const id = (email: string) => rows.find((r) => r.email === email)!.id;
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $3, 'OWNER'), ($2, $3, 'OWNER'), ($1, $4, 'OPERATOR')`,
      [E_A, E_B, id('owner@events.test'), id('operator@events.test')],
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
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  who: keyof typeof tokens = 'operator',
  tenant = E_A,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${tokens[who]}`, 'x-tenant-id': tenant },
    ...(payload ? { payload } : {}),
  });

const rect = (x: number, y: number, w: number, h: number) => ({
  type: 'Polygon',
  coordinates: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]],
});

const stand = (code: string, x: number) => ({
  id: randomUUID(),
  kind: 'STAND',
  code,
  geometry: rect(x, 0, 3, 3),
  metadata: {},
});

const STANDS = [stand('A1', 0), stand('A2', 3), stand('A3', 6)];
let publishedVersion = '';
let draftVersion = '';

/** A template whose v1 is published (3 stands + aisle) and whose v2 is a draft. */
async function preparePublishedLayout(): Promise<void> {
  const created = await call('POST', '/layout-templates', 'operator', E_A, {
    name: 'Plano eventos',
    venueId: VENUE,
  });
  publishedVersion = created.json().id;
  await call('PUT', `/layout-versions/${publishedVersion}/objects`, 'operator', E_A, {
    objects: [
      ...STANDS,
      { id: randomUUID(), kind: 'AISLE', code: null, geometry: rect(0, 4, 30, 2), metadata: {} },
    ],
  });
  expect((await call('POST', `/layout-versions/${publishedVersion}/publish`, 'owner')).statusCode).toBe(200);
  const clone = await call('POST', `/layout-templates/${created.json().templateId}/versions`, 'operator', E_A, {
    sourceVersionId: publishedVersion,
  });
  draftVersion = clone.json().id;
}

beforeAll(async () => {
  await seed();
  app = await startIntApp();
  database = app.get(DatabaseService);
  tokens.owner = await login('owner@events.test');
  tokens.operator = await login('operator@events.test');
  await preparePublishedLayout();
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

const feria = () => ({
  venueId: VENUE,
  layoutVersionId: publishedVersion,
  name: 'Feria de Primavera 2026',
  startsAt: '2026-12-05T10:00:00-03:00',
  endsAt: '2026-12-07T20:00:00-03:00',
  salesOpenAt: '2026-11-10T09:00:00-03:00',
  salesCloseAt: '2026-12-04T23:59:00-03:00',
});

type Stand = { id: string; code: string; layoutObjectId: string; priceCents: number | null; sectorId: string | null; status: string };

describe('events (EVT-01)', () => {
  let eventId = '';
  let stands: Stand[] = [];
  const byCode = (code: string) => stands.find((s) => s.code === code)!;

  it('creates a draft event with one available, unpriced stand per STAND of the layout', async () => {
    const res = await call('POST', '/events', 'operator', E_A, feria());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      status: 'DRAFT',
      slug: 'feria-de-primavera-2026',
      venueId: VENUE,
      layoutVersionId: publishedVersion,
      startsAt: '2026-12-05T13:00:00.000Z',
    });
    eventId = res.json().id;

    const list = await call('GET', `/events/${eventId}/stands`);
    expect(list.statusCode).toBe(200);
    stands = list.json();
    expect(stands.map((s) => s.code)).toEqual(['A1', 'A2', 'A3']);
    expect(stands.map((s) => s.layoutObjectId).sort()).toEqual(STANDS.map((s) => s.id).sort());
    expect(stands.every((s) => s.status === 'AVAILABLE' && s.priceCents === null && s.sectorId === null)).toBe(true);
  });

  it('refuses a draft layout (409), a foreign one (404) and incoherent dates (400)', async () => {
    expect((await call('POST', '/events', 'operator', E_A, { ...feria(), name: 'X', layoutVersionId: draftVersion })).statusCode).toBe(409);
    expect((await call('POST', '/events', 'owner', E_B, { ...feria(), name: 'Y', venueId: randomUUID() })).statusCode).toBe(404);
    for (const dates of [
      { endsAt: '2026-12-01T10:00:00-03:00' },
      { salesCloseAt: '2026-12-08T10:00:00-03:00' },
      { salesOpenAt: '2026-12-05T00:00:00-03:00' },
      { startsAt: '2026-12-05 10:00' },
    ])
      expect((await call('POST', '/events', 'operator', E_A, { ...feria(), name: 'Z', ...dates })).statusCode).toBe(400);
  });

  it('refuses a duplicate slug (409) and accepts an explicit one', async () => {
    expect((await call('POST', '/events', 'operator', E_A, feria())).statusCode).toBe(409);
    const res = await call('POST', '/events', 'operator', E_A, { ...feria(), slug: 'feria-otono-2027' });
    expect(res.statusCode).toBe(201);
    expect(res.json().slug).toBe('feria-otono-2027');
  });

  it('lists and reads events of the tenant only', async () => {
    const list = await call('GET', '/events');
    expect(list.json().map((e: { slug: string }) => e.slug).sort()).toEqual(['feria-de-primavera-2026', 'feria-otono-2027']);
    expect((await call('GET', `/events/${eventId}`)).statusCode).toBe(200);
    expect((await call('GET', `/events/${eventId}`, 'owner', E_B)).statusCode).toBe(404);
    expect((await call('GET', `/events/${eventId}/stands`, 'owner', E_B)).statusCode).toBe(404);
  });

  let diseno = '';

  it('manages sectors of the event with case-insensitive unique names', async () => {
    const res = await call('POST', `/events/${eventId}/sectors`, 'operator', E_A, { name: 'Diseño', sortOrder: 2 });
    expect(res.statusCode).toBe(201);
    diseno = res.json().id;
    expect((await call('POST', `/events/${eventId}/sectors`, 'operator', E_A, { name: ' diseño ' })).statusCode).toBe(409);
    await call('POST', `/events/${eventId}/sectors`, 'operator', E_A, { name: 'Gastronomía', sortOrder: 1 });
    const list = await call('GET', `/events/${eventId}/sectors`);
    expect(list.json().map((s: { name: string }) => s.name)).toEqual(['Gastronomía', 'Diseño']);
    const renamed = await call('PATCH', `/events/${eventId}/sectors/${diseno}`, 'operator', E_A, { name: 'Diseño y moda' });
    expect(renamed.json()).toMatchObject({ id: diseno, name: 'Diseño y moda' });
  });

  it('prices and assigns stands in bulk', async () => {
    const res = await call('PATCH', `/events/${eventId}/stands`, 'operator', E_A, {
      standIds: [byCode('A1').id, byCode('A2').id],
      priceCents: 1_500_000,
      sectorId: diseno,
    });
    expect(res.statusCode).toBe(200);
    stands = (await call('GET', `/events/${eventId}/stands`)).json();
    expect(byCode('A1')).toMatchObject({ priceCents: 1_500_000, sectorId: diseno, status: 'AVAILABLE' });
    expect(byCode('A3')).toMatchObject({ priceCents: null, sectorId: null });
  });

  it('rejects bulk updates with unknown stands, foreign sectors or invalid values', async () => {
    const other = (await call('GET', '/events')).json().find((e: { slug: string }) => e.slug === 'feria-otono-2027').id;
    const otherSector = (await call('POST', `/events/${other}/sectors`, 'operator', E_A, { name: 'Ajeno' })).json().id;
    const cases = [
      { standIds: [randomUUID()], priceCents: 1 },
      { standIds: [byCode('A1').id], sectorId: otherSector },
      { standIds: [byCode('A1').id], priceCents: -1 },
      { standIds: [byCode('A1').id], priceCents: 10.5 },
      { standIds: [byCode('A1').id], status: 'ASSIGNED' },
      { standIds: [byCode('A1').id] },
      { standIds: [], priceCents: 1 },
    ];
    for (const payload of cases)
      expect((await call('PATCH', `/events/${eventId}/stands`, 'operator', E_A, payload)).statusCode).toBe(400);
  });

  it('refuses to publish while a sellable stand has no price (422), and only for owners', async () => {
    expect((await call('POST', `/events/${eventId}/publish`, 'operator')).statusCode).toBe(403);
    const res = await call('POST', `/events/${eventId}/publish`, 'owner');
    expect(res.statusCode).toBe(422);
    expect(res.json().issues).toEqual([
      expect.objectContaining({ code: 'STAND_WITHOUT_PRICE', objectIds: [byCode('A3').id] }),
    ]);
  });

  it('publishes once every sellable stand is priced (a disabled stand needs no price)', async () => {
    await call('PATCH', `/events/${eventId}/stands`, 'operator', E_A, { standIds: [byCode('A3').id], status: 'DISABLED' });
    const res = await call('POST', `/events/${eventId}/publish`, 'owner');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'PUBLISHED', publishedAt: expect.any(String) });
  });

  it('freezes the event data after publishing, but prices can still change for new reservations', async () => {
    expect((await call('PATCH', `/events/${eventId}`, 'operator', E_A, { name: 'Otro nombre' })).statusCode).toBe(409);
    expect((await call('POST', `/events/${eventId}/publish`, 'owner')).statusCode).toBe(409);
    const price = await call('PATCH', `/events/${eventId}/stands`, 'operator', E_A, {
      standIds: [byCode('A1').id],
      priceCents: 1_600_000,
    });
    expect(price.statusCode).toBe(200);
  });

  it('edits a draft event and validates the new dates against the old ones', async () => {
    const other = (await call('GET', '/events')).json().find((e: { slug: string }) => e.slug === 'feria-otono-2027').id;
    const renamed = await call('PATCH', `/events/${other}`, 'operator', E_A, { name: 'Feria de Otoño' });
    expect(renamed.json()).toMatchObject({ name: 'Feria de Otoño', slug: 'feria-otono-2027' });
    const bad = await call('PATCH', `/events/${other}`, 'operator', E_A, { endsAt: '2026-01-01T00:00:00Z' });
    expect(bad.statusCode).toBe(400);
  });

  it('clears the sector of its stands when the sector is deleted', async () => {
    expect((await call('DELETE', `/events/${eventId}/sectors/${diseno}`, 'operator')).statusCode).toBe(204);
    stands = (await call('GET', `/events/${eventId}/stands`)).json();
    expect(byCode('A1').sectorId).toBeNull();
  });

  it('enforces INV-03 and INV-09 in the database', async () => {
    await expect(
      database.withTenant(E_A, (tx) =>
        tx.execute(sql`INSERT INTO events (venue_id, layout_version_id, name, slug, starts_at, ends_at, sales_open_at, sales_close_at)
          VALUES (${VENUE}, ${draftVersion}, 'Directo', 'directo', now() + interval '2 day', now() + interval '3 day', now(), now() + interval '1 day')`),
      ),
    ).rejects.toBeDefined(); // event on a draft layout
    const sector = (await call('POST', `/events/${eventId}/sectors`, 'operator', E_A, { name: 'Propio' })).json().id;
    const other = (await call('GET', '/events')).json().find((e: { slug: string }) => e.slug === 'feria-otono-2027').id;
    const otherStand = (await call('GET', `/events/${other}/stands`)).json()[0].id;
    await expect(
      database.withTenant(E_A, (tx) =>
        tx.execute(sql`UPDATE event_stands SET sector_id = ${sector} WHERE id = ${otherStand}`),
      ),
    ).rejects.toMatchObject({ cause: { code: '23503' } }); // sector of another event
  });

  it('audits creation and publication', async () => {
    const { rows } = await database.withTenant(E_A, (tx) =>
      tx.execute(sql`SELECT action FROM audit_logs WHERE entity_id = ${eventId} ORDER BY created_at`),
    );
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['event.created', 'event.published']));
  });

  it('keeps event tables invisible outside a tenant transaction (RLS)', async () => {
    for (const table of ['events', 'event_sectors', 'event_stands']) {
      const { rows } = await database.db.execute(sql.raw(`SELECT 1 FROM ${table}`));
      expect(rows).toEqual([]);
    }
  });
});

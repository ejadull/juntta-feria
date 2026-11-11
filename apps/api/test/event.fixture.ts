import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { ownerTestUrl } from './int.env.js';

/** Shared setup of the PUB-01 / REP-01 suites: one organization with a published event. */

export const PASSWORD = 'event fixture password';
const DAY = 86_400_000;

export async function asOwner<T>(
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export interface OrgIds {
  readonly tenant: string;
  readonly venue: string;
}

export interface OrgUsers {
  readonly owner: string;
  readonly operator: string;
  readonly exhibitor: string;
}

/** Tenant, venue and one user per role (`<role>@<slug>.test`, all confirmed). */
export async function seedOrg(
  ids: OrgIds,
  slug: string,
  name: string,
): Promise<OrgUsers> {
  const hash = await hashPassword(PASSWORD);
  return asOwner(async (c) => {
    await c.query(`INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)`, [
      ids.tenant,
      slug,
      name,
    ]);
    await c.query(
      `INSERT INTO venues (id, tenant_id, type, name, address, timezone, width_m, height_m)
       VALUES ($1, $2, 'FIXED', $3, 'Av. Publica 123, Neuquen', 'America/Argentina/Buenos_Aires', 30, 20)`,
      [ids.venue, ids.tenant, `Predio ${name}`],
    );
    const users: Record<string, string> = {};
    for (const [role, membership] of [
      ['owner', 'OWNER'],
      ['operator', 'OPERATOR'],
      ['exhibitor', 'EXHIBITOR'],
    ] as const) {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, phone, confirmed_at)
         VALUES ($1, $2, '5491100000000', now()) RETURNING id`,
        [`${role}@${slug}.test`, hash],
      );
      users[role] = rows[0].id;
      await c.query(
        `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)`,
        [ids.tenant, rows[0].id, membership],
      );
    }
    return users as unknown as OrgUsers;
  });
}

export async function login(
  app: NestFastifyApplication,
  email: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  return res.json().accessToken as string;
}

export const rect = (x: number, y: number, w: number, h: number) => ({
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

export interface FixtureEvent {
  readonly id: string;
  readonly slug: string;
  readonly layoutVersionId: string;
  readonly sectorId: string;
  /** Stands A1..A6 by code. A5 is BLOCKED, A6 DISABLED, A1-A3 are in sector "Textil" (A4 has none). */
  readonly stands: Readonly<Record<string, string>>;
}

/**
 * A template with stands A1-A6, an aisle, an entry and the sensitive kinds (EMERGENCY, UTILITY),
 * published, plus one event on it with sector "Textil" on A1-A3. With `publish: false` the event
 * stays a DRAFT. All stands are priced 1.000.000 cents; A5 is BLOCKED and A6 DISABLED.
 */
export async function createEvent(
  app: NestFastifyApplication,
  who: { token: string; tenant: string; venue: string },
  slug: string,
  publish = true,
): Promise<FixtureEvent> {
  const headers = {
    authorization: `Bearer ${who.token}`,
    'x-tenant-id': who.tenant,
  };
  const call = (method: 'POST' | 'PUT' | 'PATCH', url: string, body: object) =>
    app.inject({ method, url: `/api/v1${url}`, headers, payload: body });
  const ok = (res: { statusCode: number; body: string }, expected: number) => {
    if (res.statusCode !== expected)
      throw new Error(
        `fixture: expected ${expected}, got ${res.statusCode} ${res.body}`,
      );
  };

  const template = await call('POST', '/layout-templates', {
    name: `Plano ${slug}`,
    venueId: who.venue,
  });
  ok(template, 201);
  const versionId = template.json().id as string;
  ok(
    await call('PUT', `/layout-versions/${versionId}/objects`, {
      objects: [
        ...['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((code, i) => ({
          id: randomUUID(),
          kind: 'STAND',
          code,
          geometry: rect(i * 3, 0, 3, 3),
          metadata: { internalNote: 'private' },
        })),
        {
          id: randomUUID(),
          kind: 'AISLE',
          code: null,
          geometry: rect(0, 4, 30, 2),
          metadata: {},
        },
        {
          id: randomUUID(),
          kind: 'ENTRY',
          code: 'Acceso principal',
          geometry: rect(0, 7, 3, 1),
          metadata: {},
        },
        {
          id: randomUUID(),
          kind: 'EMERGENCY',
          code: 'Salida de emergencia',
          geometry: rect(10, 7, 3, 1),
          metadata: {},
        },
        {
          id: randomUUID(),
          kind: 'UTILITY',
          code: 'Tablero electrico',
          geometry: rect(14, 7, 1, 1),
          metadata: {},
        },
      ],
    }),
    200,
  );
  ok(await call('POST', `/layout-versions/${versionId}/publish`, {}), 200);

  const now = Date.now();
  const created = await call('POST', '/events', {
    venueId: who.venue,
    layoutVersionId: versionId,
    name: `Feria ${slug}`,
    slug,
    salesOpenAt: new Date(now - DAY).toISOString(),
    salesCloseAt: new Date(now + 5 * DAY).toISOString(),
    startsAt: new Date(now + 6 * DAY).toISOString(),
    endsAt: new Date(now + 7 * DAY).toISOString(),
  });
  ok(created, 201);
  const eventId = created.json().id as string;

  const sector = await call('POST', `/events/${eventId}/sectors`, {
    name: 'Textil',
  });
  ok(sector, 201);
  const list = await app.inject({
    method: 'GET',
    url: `/api/v1/events/${eventId}/stands`,
    headers,
  });
  const stands: Record<string, string> = {};
  for (const s of list.json() as { id: string; code: string }[])
    stands[s.code] = s.id;
  ok(
    await call('PATCH', `/events/${eventId}/stands`, {
      standIds: Object.values(stands),
      priceCents: 1_000_000,
    }),
    200,
  );
  ok(
    await call('PATCH', `/events/${eventId}/stands`, {
      standIds: [stands.A1, stands.A2, stands.A3],
      sectorId: sector.json().id,
    }),
    200,
  );
  ok(
    await call('PATCH', `/events/${eventId}/stands`, {
      standIds: [stands.A5],
      status: 'BLOCKED',
    }),
    200,
  );
  ok(
    await call('PATCH', `/events/${eventId}/stands`, {
      standIds: [stands.A6],
      status: 'DISABLED',
    }),
    200,
  );
  if (publish) ok(await call('POST', `/events/${eventId}/publish`, {}), 200);
  return {
    id: eventId,
    slug,
    layoutVersionId: versionId,
    sectorId: sector.json().id as string,
    stands,
  };
}

/** Exhibitor profile of `userId` in `tenant`; `consent` is the public-directory opt-in (AC-11). */
export async function addExhibitor(
  tenant: string,
  userId: string,
  profile: { tradeName: string; consent: boolean },
): Promise<string> {
  return asOwner(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO exhibitors (tenant_id, user_id, legal_name, trade_name, tax_id, category, description,
                               public_contact_opt_in, public_consent_at)
       VALUES ($1, $2, $3, $4, '20123456786', 'Textiles', 'Tejidos artesanales', $5::boolean,
               CASE WHEN $5::boolean THEN now() END)
       RETURNING id`,
      [
        tenant,
        userId,
        `${profile.tradeName} Sociedad Anonima`,
        profile.tradeName,
        profile.consent,
      ],
    );
    return rows[0].id;
  });
}

/** Inserts a reservation straight into the database (fixtures only; the API path is RES-01). */
export async function addReservation(
  tenant: string,
  standId: string,
  exhibitorId: string,
  userId: string,
  status: string,
  createdAt: Date = new Date(),
  priceCents = 1_000_000,
): Promise<string> {
  return asOwner(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO reservations (tenant_id, event_stand_id, exhibitor_id, user_id, status, hold_expires_at,
                                 price_cents, currency, terms_version, idempotency_key, created_at)
       VALUES ($1, $2, $3, $4, $5::text, CASE WHEN $5::text = 'HELD' THEN now() + interval '15 minutes' END,
               $6, 'ARS', '2026-10-01', $7, $8)
       RETURNING id`,
      [
        tenant,
        standId,
        exhibitorId,
        userId,
        status,
        priceCents,
        randomUUID(),
        createdAt,
      ],
    );
    return rows[0].id;
  });
}

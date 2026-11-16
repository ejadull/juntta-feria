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
 * PUB-01 against a real PostgreSQL: the unauthenticated portal shows events that are on sale,
 * their map and consented exhibitors, and nothing else (INV-08, AC-11, AC-PRD-03).
 */

const A = {
  tenant: 'a1a1a1a1-5a5a-4a5a-8a5a-a1a1a1a1a1a1',
  venue: 'a2a2a2a2-5a5a-4a5a-8a5a-a2a2a2a2a2a2',
};
const B = {
  tenant: 'b1b1b1b1-5b5b-4b5b-8b5b-b1b1b1b1b1b1',
  venue: 'b2b2b2b2-5b5b-4b5b-8b5b-b2b2b2b2b2b2',
};

let app: NestFastifyApplication;
let sale: FixtureEvent;
let draft: FixtureEvent;
let other: FixtureEvent;

const get = (url: string) =>
  app.inject({ method: 'GET', url: `/api/v1/public${url}` });

beforeAll(async () => {
  const usersA = await seedOrg(A, 'portal-a', 'Portal A');
  await seedOrg(B, 'portal-b', 'Portal B');
  app = await startIntApp();
  const ownerA = { token: await login(app, 'owner@portal-a.test'), ...A };
  const ownerB = { token: await login(app, 'owner@portal-b.test'), ...B };
  sale = await createEvent(app, ownerA, 'portal-feria');
  draft = await createEvent(app, ownerA, 'portal-borrador', false);
  other = await createEvent(app, ownerB, 'portal-otra-feria');

  const consenting = await addExhibitor(A.tenant, usersA.exhibitor, {
    tradeName: 'Telares Sur',
    consent: true,
  });
  const withoutConsent = await addExhibitor(A.tenant, usersA.operator, {
    tradeName: 'Secreto Hnos',
    consent: false,
  });
  const holder = await addExhibitor(A.tenant, usersA.owner, {
    tradeName: 'Retenedor Pendiente',
    consent: true,
  });
  const confirmed = (stand: string, who: string, user: string) =>
    addReservation(A.tenant, stand, who, user, 'CONFIRMED');
  await confirmed(sale.stands.A1, consenting, usersA.exhibitor);
  await confirmed(sale.stands.A2, withoutConsent, usersA.operator);
  await addReservation(A.tenant, sale.stands.A4, holder, usersA.owner, 'HELD');
}, 120_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

describe('public portal (PUB-01)', () => {
  it('lists events on sale of every organization, without credentials or a tenant', async () => {
    const res = await get('/events');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const list = res.json() as { slug: string }[];
    const slugs = list.map((e) => e.slug);
    expect(slugs).toEqual(
      expect.arrayContaining(['portal-feria', 'portal-otra-feria']),
    );
    expect(slugs).not.toContain('portal-borrador');
    const ours = list.find((e) => e.slug === 'portal-feria')!;
    expect(Object.keys(ours).sort()).toEqual([
      'availableStands',
      'endsAt',
      'name',
      'organizerName',
      'salesOpen',
      'slug',
      'startsAt',
      'totalStands',
      'venueAddress',
      'venueName',
    ]);
    expect(ours).toMatchObject({
      name: 'Feria portal-feria',
      organizerName: 'Portal A',
      venueName: 'Predio Portal A',
      salesOpen: true,
      // A1-A5 are sellable inventory (A6 is disabled); only A3 is free, priced and unreserved.
      totalStands: 5,
      availableStands: 1,
    });
  });

  it('shows the event page with its sectors', async () => {
    const res = await get('/events/portal-feria');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.json()).toMatchObject({
      slug: 'portal-feria',
      organizerName: 'Portal A',
      sectors: ['Textil'],
    });
  });

  it('draws the map with visitor states and consented exhibitors only', async () => {
    const res = await get('/events/portal-feria/map');
    expect(res.statusCode).toBe(200);
    // Availability moves fast: a much shorter TTL than the catalog (spec 5.3).
    expect(res.headers['cache-control']).toBe('public, max-age=15');
    const map = res.json();
    expect(map).toMatchObject({
      slug: 'portal-feria',
      layoutVersion: 1,
      units: 'm',
      bounds: { width: 30, height: 20 },
    });
    type Feature = {
      geometry: { type: string };
      properties: Record<string, unknown>;
    };
    const features = map.features as Feature[];
    const stands = Object.fromEntries(
      features
        .filter((f) => f.properties.kind === 'STAND')
        .map((f) => [f.properties.code as string, f.properties]),
    );
    expect(Object.keys(stands).sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
    expect(stands.A1).toMatchObject({
      status: 'OCCUPIED',
      sector: 'Textil',
      areaM2: 9,
      standId: sale.stands.A1,
      price: { currency: 'ARS', valueCents: 1_000_000 },
      exhibitor: {
        name: 'Telares Sur',
        category: 'Textiles',
        description: 'Tejidos artesanales',
      },
    });
    // Taken by someone who did not consent: the stand is occupied, the name is not published.
    expect(stands.A2).toMatchObject({ status: 'OCCUPIED', exhibitor: null });
    // The description travels under the same consent as the name: never for A2.
    expect(JSON.stringify(stands.A2)).not.toContain('Tejidos');
    expect(stands.A3).toMatchObject({ status: 'AVAILABLE', exhibitor: null });
    // A hold shows as reserved and never names the holder, consent or not.
    expect(stands.A4).toMatchObject({
      status: 'RESERVED',
      sector: null,
      exhibitor: null,
    });
    expect(stands.A5).toMatchObject({ status: 'BLOCKED' });
    const kinds = features.map((f) => f.properties.kind);
    expect(kinds).toEqual(expect.arrayContaining(['AISLE', 'ENTRY']));
    // Emergency routes and utilities are operational data, not map content.
    expect(kinds).not.toContain('EMERGENCY');
    expect(kinds).not.toContain('UTILITY');
    expect(JSON.stringify(map)).not.toContain('Tablero');
    expect(features.every((f) => f.geometry.type === 'Polygon')).toBe(true);
  });

  it('lists only exhibitors with a public profile and a confirmed stand', async () => {
    const res = await get('/events/portal-feria/exhibitors');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        name: 'Telares Sur',
        category: 'Textiles',
        description: 'Tejidos artesanales',
        standCode: 'A1',
      },
    ]);
  });

  it('never exposes contacts, tax data, private records, reservations or payments', async () => {
    const bodies = (
      await Promise.all(
        [
          '/events',
          '/events/portal-feria',
          '/events/portal-feria/map',
          '/events/portal-feria/exhibitors',
        ].map(async (url) => (await get(url)).body),
      )
    ).join('\n');
    for (const secret of [
      '@portal-a.test', // any user email
      '5491100000000', // phone
      '20123456786', // CUIT
      'Sociedad Anonima', // legal name
      'Secreto Hnos', // exhibitor without consent
      'Retenedor Pendiente', // holder of a hold
      'internalNote', // layout object metadata
      'tenantId',
      'tenant_id',
      'holdExpiresAt',
      'termsVersion',
      'userId',
      'exhibitorId',
      'reservation',
      'payment',
      'taxId',
      'legalName',
      'email',
      'phone',
    ])
      expect(bodies, secret).not.toContain(secret);
  });

  it('answers 404 for a draft event on every route', async () => {
    for (const path of ['', '/map', '/exhibitors'])
      expect((await get(`/events/${draft.slug}${path}`)).statusCode).toBe(404);
    const list = (await get('/events')).json() as { slug: string }[];
    expect(list.map((e) => e.slug)).not.toContain(draft.slug);
  });

  it('answers 404 for unknown and malformed slugs, with the same body as a draft', async () => {
    const draftRes = await get(`/events/${draft.slug}`);
    for (const slug of ['no-existe', 'NO_VALID', "x'--", 'a'.repeat(90)]) {
      const res = await get(`/events/${encodeURIComponent(slug)}`);
      expect(res.statusCode).toBe(404);
      expect(res.json().detail).toBe(draftRes.json().detail);
    }
  });

  it('refuses an oversized slug with a client error, never a 5xx', async () => {
    // Fastify caps route params (414) before the handler runs.
    const res = await get(`/events/${'a'.repeat(300)}`);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it('keeps each organization to its own data under the same public route', async () => {
    const res = await get(`/events/${other.slug}/map`);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(sale.stands.A1);
    expect(res.body).not.toContain('Telares Sur');
    expect((await get(`/events/${other.slug}/exhibitors`)).json()).toEqual([]);
  });

  it('hides an event once it is closed or its organization is suspended', async () => {
    const setEvent = (status: string) =>
      asOwner((c) =>
        c.query(`UPDATE events SET status = $2 WHERE id = $1`, [
          sale.id,
          status,
        ]),
      );
    const setTenant = (status: string) =>
      asOwner((c) =>
        c.query(`UPDATE tenants SET status = $2 WHERE id = $1`, [
          A.tenant,
          status,
        ]),
      );
    await setEvent('CLOSED');
    expect((await get(`/events/${sale.slug}`)).statusCode).toBe(404);
    await setEvent('ACTIVE');
    expect((await get(`/events/${sale.slug}`)).statusCode).toBe(200);
    await setTenant('SUSPENDED');
    expect((await get(`/events/${sale.slug}/map`)).statusCode).toBe(404);
    const slugs = ((await get('/events')).json() as { slug: string }[]).map(
      (e) => e.slug,
    );
    expect(slugs).not.toContain(sale.slug);
    await setTenant('ACTIVE');
  });
});

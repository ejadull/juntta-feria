import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import { PublicationRetentionSweeper } from '../src/exhibitors/publication-retention.service.js';
import { OBJECT_STORAGE } from '../src/storage/object-storage.js';
import { FakeObjectStorage } from './fake-object-storage.js';
import { startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * EXH-09 / MED-03, MED-11, MED-12 against a real PostgreSQL with an in-memory storage: profile
 * photos and event publications (upload rules, limits, stand and event checks), the organizer's
 * hide/show and the retention job that deletes publications of ended events.
 */

const PASSWORD = 'publications test password';
const T = 'b6b6b6b6-b6b6-4b6b-8b6b-b6b6b6b6b6b6';
const VENUE = 'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5';
const DAY = 86_400_000;
const MB = 1024 * 1024;

type Who = 'owner' | 'ana' | 'beto';
const PEOPLE: Who[] = ['owner', 'ana', 'beto'];
const tokens = {} as Record<Who, string>;

let app: NestFastifyApplication;
let database: DatabaseService;
const storage = new FakeObjectStorage();
let eventId = '';

async function owner<R>(fn: (c: pg.Client) => Promise<R>): Promise<R> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
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

async function seed(): Promise<void> {
  await owner(async (c) => {
    const hash = await hashPassword(PASSWORD);
    await c.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'publications-a', 'Publications A')`,
      [T],
    );
    await c.query(
      `INSERT INTO venues (id, tenant_id, type, name, timezone, width_m, height_m)
       VALUES ($1, $2, 'FIXED', 'Predio publicaciones', 'America/Argentina/Buenos_Aires', 30, 20)`,
      [VENUE, T],
    );
    for (const who of PEOPLE) {
      const user = await c.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, confirmed_at, full_name) VALUES ($1, $2, now(), $3) RETURNING id`,
        [`${who}@publications.test`, hash, `Persona ${who} de Prueba`],
      );
      const id = user.rows[0].id;
      await c.query(
        `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)`,
        [T, id, who === 'owner' ? 'OWNER' : 'EXHIBITOR'],
      );
      if (who === 'owner') continue;
      await c.query(
        `INSERT INTO exhibitors (tenant_id, user_id, legal_name, trade_name, tax_id)
         VALUES ($1, $2, $3, $4, '20123456786')`,
        [T, id, `Feriante ${who}`, who === 'ana' ? 'Ana' : 'Beto'],
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
    payload: { email: `${who}@publications.test`, password: PASSWORD },
  });
  return res.json().accessToken as string;
}

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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
      'x-tenant-id': T,
      ...headers,
    },
    ...(payload ? { payload } : {}),
  });

async function createProfile(who: 'ana' | 'beto', name: string): Promise<void> {
  const category = await call('POST', '/exhibitor-categories', 'owner', {
    name: `Rubro ${name}`,
  });
  await call('PUT', '/me/exhibitor-profile', who, {
    legalName: `${name} S.A.`,
    tradeName: name,
    taxId: '20123456786',
    categoryId: category.json().id,
    publicContactOptIn: false,
  });
}

/** Asks for an upload; the caller "uploads" the object with `storage.simulateUpload`. */
const requestUpload = (who: 'ana' | 'beto', body: object) =>
  call('POST', '/exhibitors/me/photos', who, body);

const complete = (who: 'ana' | 'beto', id: string) =>
  call('POST', `/exhibitors/me/photos/${id}/complete`, who);

const mine = async () =>
  (await call('GET', '/exhibitors/me/photos', 'ana')).json() as {
    id: string;
    status: string;
    eventId: string | null;
  }[];

const video = (overrides: Record<string, unknown> = {}) => ({
  contentType: 'video/mp4',
  sizeBytes: 5 * MB,
  eventId,
  caption: 'Así se tiñe la lana',
  durationS: 20,
  ...overrides,
});

const profileImage = () => ({
  contentType: 'image/jpeg',
  sizeBytes: 200_000,
  alt: 'Stand de Ana',
});

beforeAll(async () => {
  await seed();
  app = await startIntApp([], [[OBJECT_STORAGE, storage]]);
  database = app.get(DatabaseService);
  for (const who of PEOPLE) tokens[who] = await login(who);
  await createProfile('ana', 'Ana');
  await createProfile('beto', 'Beto');

  const template = await call('POST', '/layout-templates', 'owner', {
    name: 'Plano publicaciones',
    venueId: VENUE,
  });
  const version = template.json().id as string;
  await call('PUT', `/layout-versions/${version}/objects`, 'owner', {
    objects: ['P1', 'P2'].map((code, i) => ({
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
    name: 'Feria publicaciones',
    slug: 'feria-publicaciones',
    salesOpenAt: new Date(now - DAY).toISOString(),
    salesCloseAt: new Date(now + 5 * DAY).toISOString(),
    startsAt: new Date(now + 6 * DAY).toISOString(),
    endsAt: new Date(now + 7 * DAY).toISOString(),
  });
  eventId = created.json().id as string;
  const list: { id: string; code: string }[] = (
    await call('GET', `/events/${eventId}/stands`, 'owner')
  ).json();
  const stands = Object.fromEntries(list.map((s) => [s.code, s.id]));
  await call('PATCH', `/events/${eventId}/stands`, 'owner', {
    standIds: Object.values(stands),
    priceCents: 1000,
  });
  expect(
    (await call('POST', `/events/${eventId}/publish`, 'owner')).statusCode,
  ).toBe(200);

  // Ana holds P1 and her reservation is confirmed; beto holds nothing in this event.
  const hold = await call(
    'POST',
    '/reservations',
    'ana',
    { eventStandId: stands.P1, termsVersion: '2026-10-01' },
    { 'idempotency-key': randomUUID() },
  );
  expect(hold.statusCode, hold.body).toBe(201);
  await owner((c) =>
    c.query(`UPDATE reservations SET status = 'CONFIRMED' WHERE id = $1`, [
      hold.json().id,
    ]),
  );
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

describe('profile photos (MED-03)', () => {
  it('confirms a profile photo as READY and lists it with a signed URL only', async () => {
    const res = await requestUpload('ana', profileImage());
    expect(res.json().photo).toMatchObject({
      kind: 'IMAGE',
      eventId: null,
      status: 'PENDING',
    });
    storage.simulateUpload(res.json().upload.url, {
      sizeBytes: 200_000,
      contentType: 'image/jpeg',
    });
    const done = await complete('ana', res.json().photo.id);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({
      status: 'READY',
      url: expect.any(String),
    });
    expect((await mine()).map((p) => p.id)).toContain(res.json().photo.id);
    expect(JSON.stringify(await mine())).not.toContain('storageKey');
  });

  it('answers 409 UPLOAD_MISSING until the object is in the storage', async () => {
    const res = await requestUpload('ana', profileImage());
    const done = await complete('ana', res.json().photo.id);
    expect(done.statusCode).toBe(409);
    expect(done.json().code).toBe('UPLOAD_MISSING');
  });

  it('rejects an object whose real type differs from the declared one (422) and removes it', async () => {
    const res = await requestUpload('ana', profileImage());
    const key = storage.simulateUpload(res.json().upload.url, {
      sizeBytes: 200_000,
      contentType: 'image/png',
    });
    const done = await complete('ana', res.json().photo.id);
    expect(done.statusCode).toBe(422);
    expect(done.json().code).toBe('UPLOAD_REJECTED');
    expect(storage.objects.has(key)).toBe(false);
  });

  it('caps the profile at six READY photos (409 PHOTO_LIMIT on the seventh)', async () => {
    const readyBefore = (await mine()).filter((p) => p.status === 'READY').length;
    const ids: string[] = [];
    for (let i = readyBefore; i < 7; i++) {
      const res = await requestUpload('ana', profileImage());
      storage.simulateUpload(res.json().upload.url, {
        sizeBytes: 200_000,
        contentType: 'image/jpeg',
      });
      ids.push(res.json().photo.id);
    }
    for (const id of ids.slice(0, -1))
      expect((await complete('ana', id)).statusCode).toBe(200);
    const last = await complete('ana', ids.at(-1)!);
    expect(last.statusCode).toBe(409);
    expect(last.json().code).toBe('PHOTO_LIMIT');
  });
});

describe('publications in an event (MED-03)', () => {
  it('refuses a publication from an exhibitor without a confirmed stand (403)', async () => {
    const res = await requestUpload('beto', video());
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('NO_STAND_IN_EVENT');
  });

  it('requires a duration for a video (400) and signs nothing', async () => {
    const before = storage.uploads.length;
    const res = await requestUpload('ana', video({ durationS: undefined }));
    expect(res.statusCode).toBe(400);
    expect(storage.uploads).toHaveLength(before);
  });

  it('turns a real video into a READY publication of the event, audited', async () => {
    const res = await requestUpload('ana', video());
    expect(res.statusCode).toBe(201);
    const { photo, upload } = res.json();
    expect(photo).toMatchObject({
      kind: 'VIDEO',
      eventId,
      status: 'PENDING',
      durationS: 20,
    });
    expect((await complete('ana', photo.id)).statusCode).toBe(409);
    const key = storage.simulateUpload(upload.url, {
      sizeBytes: 5 * MB,
      contentType: 'video/mp4',
    });
    const done = await complete('ana', photo.id);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({
      status: 'READY',
      caption: 'Así se tiñe la lana',
    });
    expect(storage.objects.has(key)).toBe(true);
    const { rows } = await database.withTenant(T, (tx) =>
      tx.execute(
        sql`SELECT action FROM audit_logs WHERE entity_id = ${photo.id}`,
      ),
    );
    expect(rows.map((r) => r.action)).toEqual(['exhibitor_photo.uploaded']);
  });

  it('edits the caption of a publication, and not the text of a profile photo', async () => {
    const list = await mine();
    const publication = list.find((p) => p.eventId === eventId)!;
    const ok = await call(
      'PATCH',
      `/exhibitors/me/photos/${publication.id}`,
      'ana',
      { caption: 'Lana teñida a mano' },
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.json().caption).toBe('Lana teñida a mano');
    const profile = list.find((p) => p.eventId === null)!;
    const res = await call(
      'PATCH',
      `/exhibitors/me/photos/${profile.id}`,
      'ana',
      { caption: 'x' },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('NOT_A_PUBLICATION');
  });

  it('answers 404 when another exhibitor edits the photo', async () => {
    const publication = (await mine()).find((p) => p.eventId === eventId)!;
    const res = await call(
      'PATCH',
      `/exhibitors/me/photos/${publication.id}`,
      'beto',
      { caption: 'robado' },
    );
    expect(res.statusCode).toBe(404);
  });

  it('caps an exhibitor at ten publications per event (409 PUBLICATION_LIMIT)', async () => {
    // One READY publication exists; pending requests count too, so nine more reach the limit.
    for (let i = 0; i < 9; i++) {
      const res = await requestUpload('ana', video({ caption: `Publicación ${i}` }));
      expect(res.statusCode).toBe(201);
    }
    const res = await requestUpload('ana', video());
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PUBLICATION_LIMIT');
  });
});

describe('organizer moderation (MED-11)', () => {
  it('lists only the published publications of the event, with the exhibitor name', async () => {
    const res = await call('GET', `/events/${eventId}/publications`, 'owner');
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      status: 'READY',
      kind: 'VIDEO',
      exhibitorName: 'Ana',
    });
    expect(list[0].url).toEqual(expect.any(String));
  });

  it('is for organizers only (403 for an exhibitor)', async () => {
    const res = await call('GET', `/events/${eventId}/publications`, 'ana');
    expect(res.statusCode).toBe(403);
  });

  it('hides and shows a publication, audits each change, and the exhibitor sees the mark', async () => {
    const [publication] = (
      await call('GET', `/events/${eventId}/publications`, 'owner')
    ).json();
    const hidden = await call(
      'PATCH',
      `/events/${eventId}/publications/${publication.id}`,
      'owner',
      { hidden: true },
    );
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().status).toBe('HIDDEN');
    expect(
      (await mine()).find((p) => p.id === publication.id)!.status,
    ).toBe('HIDDEN');

    const shown = await call(
      'PATCH',
      `/events/${eventId}/publications/${publication.id}`,
      'owner',
      { hidden: false },
    );
    expect(shown.json().status).toBe('READY');

    const { rows } = await database.withTenant(T, (tx) =>
      tx.execute(
        sql`SELECT action FROM audit_logs WHERE entity_id = ${publication.id} ORDER BY created_at`,
      ),
    );
    expect(rows.map((r) => r.action)).toEqual([
      'exhibitor_photo.uploaded',
      'exhibitor_publication.hidden',
      'exhibitor_publication.shown',
    ]);
  });

  it('answers 404 for an unknown publication of the event', async () => {
    const res = await call(
      'PATCH',
      `/events/${eventId}/publications/${randomUUID()}`,
      'owner',
      { hidden: true },
    );
    expect(res.statusCode).toBe(404);
  });

  it('is refused to a member who is not an organizer (403)', async () => {
    const [publication] = (
      await call('GET', `/events/${eventId}/publications`, 'owner')
    ).json();
    const res = await call(
      'PATCH',
      `/events/${eventId}/publications/${publication.id}`,
      'beto',
      { hidden: true },
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('retention of ended events (MED-12)', () => {
  it('refuses new publications and caption edits once the event has ended (409 EVENT_CLOSED)', async () => {
    await owner((c) =>
      c.query(
        `UPDATE events SET sales_open_at = now() - interval '4 days',
           sales_close_at = now() - interval '2 days',
           starts_at = now() - interval '3 days',
           ends_at = now() - interval '1 day'
         WHERE id = $1`,
        [eventId],
      ),
    );
    const post = await requestUpload('ana', video());
    expect(post.statusCode).toBe(409);
    expect(post.json().code).toBe('EVENT_CLOSED');
    const publication = (await mine()).find((p) => p.eventId === eventId)!;
    const edit = await call(
      'PATCH',
      `/exhibitors/me/photos/${publication.id}`,
      'ana',
      { caption: 'tarde' },
    );
    expect(edit.json().code).toBe('EVENT_CLOSED');
  });

  it('deletes the rows and files of the ended event, keeps profile photos, and audits each', async () => {
    const profilesBefore = (await mine()).filter((p) => p.eventId === null)
      .length;
    const deleted = await app
      .get(PublicationRetentionSweeper)
      .sweepTenant(T, new Date());
    expect(deleted).toBe(10); // one READY publication and nine pending ones
    const { rows } = await database.withTenant(T, (tx) =>
      tx.execute(
        sql`SELECT count(*)::int AS n FROM exhibitor_photos WHERE event_id = ${eventId}`,
      ),
    );
    expect(rows[0].n).toBe(0);
    expect((await mine()).filter((p) => p.eventId === null)).toHaveLength(
      profilesBefore,
    );
    const audit = await database.withTenant(T, (tx) =>
      tx.execute(
        sql`SELECT count(*)::int AS n FROM audit_logs
            WHERE action = 'exhibitor_publication.retention_deleted'
              AND before_json->>'eventId' = ${eventId}`,
      ),
    );
    expect(audit.rows[0].n).toBe(10);
  });

  it('is idempotent: a second run deletes nothing more', async () => {
    const deleted = await app
      .get(PublicationRetentionSweeper)
      .sweepTenant(T, new Date());
    expect(deleted).toBe(0);
  });
});

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
 * MED-04 against a real PostgreSQL: the publications of an event reach the public map only when
 * the exhibitor consented, the publication is READY, and the event has not ended. Hidden, pending,
 * other-event and non-consenting publications never leave the API, and no storage key is returned.
 */

const C = {
  tenant: 'c7c7c7c7-c7c7-4c7c-8c7c-c7c7c7c7c7c7',
  venue: 'c8c8c8c8-c8c8-4c8c-8c8c-c8c8c8c8c8c8',
};

let app: NestFastifyApplication;
let feria: FixtureEvent;
let otra: FixtureEvent;
let consentingId = '';
let silentId = '';

const ids = {
  visible: randomUUID(),
  hidden: randomUUID(),
  pending: randomUUID(),
  otherEvent: randomUUID(),
  silent: randomUUID(),
};

const keyOf = (id: string) => `tenants/${C.tenant}/exhibitors/media/${id}`;

const get = (url: string) =>
  app.inject({ method: 'GET', url: `/api/v1/public${url}` });

/** Inserts a video publication straight into the database (fixtures only; the API path is MED-03). */
function publication(
  id: string,
  exhibitorId: string,
  eventId: string,
  status: 'READY' | 'HIDDEN' | 'PENDING',
  caption: string,
): Promise<void> {
  return asOwner(async (c) => {
    await c.query(
      `INSERT INTO exhibitor_photos (id, tenant_id, exhibitor_id, status, storage_key, content_type,
                                     size_bytes, kind, event_id, caption, duration_s, position)
       VALUES ($1, $2, $3, $4, $5, 'video/mp4', 5000000, 'VIDEO', $6, $7, 20, 0)`,
      [id, C.tenant, exhibitorId, status, keyOf(id), eventId, caption],
    );
  });
}

beforeAll(async () => {
  const users = await seedOrg(C, 'media-map', 'Media Map');
  app = await startIntApp();
  const owner = { token: await login(app, 'owner@media-map.test'), ...C };
  feria = await createEvent(app, owner, 'media-feria');
  otra = await createEvent(app, owner, 'media-otra');

  consentingId = await addExhibitor(C.tenant, users.exhibitor, {
    tradeName: 'Telares Norte',
    consent: true,
  });
  silentId = await addExhibitor(C.tenant, users.operator, {
    tradeName: 'Silencio Hnos',
    consent: false,
  });
  await addReservation(C.tenant, feria.stands.A1, consentingId, users.exhibitor, 'CONFIRMED');
  await addReservation(C.tenant, feria.stands.A2, silentId, users.operator, 'CONFIRMED');

  await publication(ids.visible, consentingId, feria.id, 'READY', 'Telar en vivo');
  await publication(ids.hidden, consentingId, feria.id, 'HIDDEN', 'Oculta por el organizador');
  await publication(ids.pending, consentingId, feria.id, 'PENDING', 'Aún subiendo');
  await publication(ids.otherEvent, consentingId, otra.id, 'READY', 'De otra feria');
  await publication(ids.silent, silentId, feria.id, 'READY', 'Sin consentimiento');
}, 120_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

interface MapBody {
  features: { properties: Record<string, unknown> }[];
}
interface MediaItem {
  id: string;
  kind: string;
  url: string;
  alt: string;
  caption: string | null;
  durationS: number | null;
}

const exhibitorOfA1 = (map: MapBody) =>
  (map.features.find((f) => f.properties.code === 'A1')!.properties as {
    exhibitor: { name: string; media: MediaItem[] } | null;
  }).exhibitor;

describe('publications on the public map (MED-04)', () => {
  it('shows a READY publication of a consenting exhibitor, with its caption and duration', async () => {
    const res = await get(`/events/${feria.slug}/map`);
    expect(res.statusCode).toBe(200);
    const exhibitor = exhibitorOfA1(res.json())!;
    expect(exhibitor.name).toBe('Telares Norte');
    expect(exhibitor.media).toEqual([
      {
        id: ids.visible,
        kind: 'VIDEO',
        url: expect.any(String),
        alt: 'Telar en vivo',
        caption: 'Telar en vivo',
        durationS: 20,
      },
    ]);
  });

  it('never shows hidden, pending, other-event or non-consenting publications', async () => {
    const body = (await get(`/events/${feria.slug}/map`)).body;
    for (const id of [ids.hidden, ids.pending, ids.otherEvent, ids.silent])
      expect(body).not.toContain(id);
    for (const text of [
      'Oculta por el organizador',
      'Aún subiendo',
      'De otra feria',
      'Sin consentimiento',
    ])
      expect(body).not.toContain(text);
  });

  it('returns each publication with exactly its public fields, never a storage key field', async () => {
    const body = (await get(`/events/${feria.slug}/map`)).json();
    const [media] = exhibitorOfA1(body)!.media;
    expect(Object.keys(media).sort()).toEqual(
      ['alt', 'caption', 'durationS', 'id', 'kind', 'url'],
    );
    expect(JSON.stringify(body)).not.toContain('storageKey');
    expect(JSON.stringify(body)).not.toContain('storage_key');
  });

  it('shows no publication once the event has ended, and never a server error', async () => {
    await asOwner((c) =>
      c.query(
        `UPDATE events SET sales_open_at = now() - interval '4 days',
           sales_close_at = now() - interval '2 days',
           starts_at = now() - interval '3 days',
           ends_at = now() - interval '1 day'
         WHERE id = $1`,
        [feria.id],
      ),
    );
    const res = await get(`/events/${feria.slug}/map`);
    expect(res.statusCode).toBeLessThan(500);
    // The event may already be out of the portal (404); if the map still answers, it has no media.
    if (res.statusCode === 200) expect(res.body).not.toContain(ids.visible);
    else expect(res.statusCode).toBe(404);
  });
});

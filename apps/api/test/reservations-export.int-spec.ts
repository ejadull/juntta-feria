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

/** REP-01 CSV export against a real PostgreSQL: columns, escaping, injection guard, roles, tenancy. */

const M = {
  tenant: 'e1e1e1e1-6e6e-4e6e-8e6e-e1e1e1e1e1e1',
  venue: 'e2e2e2e2-6e6e-4e6e-8e6e-e2e2e2e2e2e2',
};
const N = {
  tenant: 'f1f1f1f1-6f6f-4f6f-8f6f-f1f1f1f1f1f1',
  venue: 'f2f2f2f2-6f6f-4f6f-8f6f-f2f2f2f2f2f2',
};

let app: NestFastifyApplication;
let event: FixtureEvent;
const tokens = { owner: '', operator: '', exhibitor: '', foreign: '' };

const exportCsv = (who: keyof typeof tokens, id = event.id) =>
  app.inject({
    method: 'GET',
    url: `/api/v1/events/${id}/reservations/export`,
    headers: {
      authorization: `Bearer ${tokens[who]}`,
      'x-tenant-id': who === 'foreign' ? N.tenant : M.tenant,
    },
  });

beforeAll(async () => {
  const users = await seedOrg(M, 'export-a', 'Export A');
  await seedOrg(N, 'export-b', 'Export B');
  app = await startIntApp();
  tokens.owner = await login(app, 'owner@export-a.test');
  tokens.operator = await login(app, 'operator@export-a.test');
  tokens.exhibitor = await login(app, 'exhibitor@export-a.test');
  tokens.foreign = await login(app, 'owner@export-b.test');
  event = await createEvent(app, { token: tokens.owner, ...M }, 'export-feria');
  const ana = await addExhibitor(M.tenant, users.exhibitor, {
    tradeName: 'Ana, "Telas" y Más',
    consent: true,
  });
  const evil = await addExhibitor(M.tenant, users.operator, {
    tradeName: '=HYPERLINK("http://x")',
    consent: false,
  });
  const paid = await addReservation(
    M.tenant,
    event.stands.A1,
    ana,
    users.exhibitor,
    'CONFIRMED',
    new Date('2026-11-01T12:00:00Z'),
    1_234_550,
  );
  await asOwner((c) =>
    c.query(
      `INSERT INTO payment_attempts (tenant_id, reservation_id, status, amount_cents, currency, expires_at,
                                     idempotency_key, payment_id, payment_status)
       VALUES ($1, $2, 'APPROVED', 1234550, 'ARS', now() + interval '1 hour', $3, 'MP-998877', 'approved')`,
      [M.tenant, paid, randomUUID()],
    ),
  );
  await addReservation(M.tenant, event.stands.A2, evil, users.operator, 'HELD');
}, 120_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

describe('reservations CSV export (REP-01)', () => {
  it('returns one row per reservation as an attachment with BOM', async () => {
    const res = await exportCsv('operator');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="reservas-export-feria-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.body.startsWith('﻿')).toBe(true);
    const lines = res.body.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Stand,Sector,Expositor,Email,Estado,Monto (ARS),Creada,Actualizada,Estado del pago,ID de pago',
    );
    expect(lines).toHaveLength(3);
  });

  it('fills the money and payment columns and escapes commas and quotes', async () => {
    const body = (await exportCsv('owner')).body;
    expect(body).toContain(
      'A1,Textil,"Ana, ""Telas"" y Más",exhibitor@export-a.test,CONFIRMED,12345.50,2026-11-01T12:00:00Z,',
    );
    expect(body).toContain(',approved,MP-998877\r\n');
  });

  it('neutralizes formula injection in text cells', async () => {
    const body = (await exportCsv('owner')).body;
    expect(body).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(body).not.toMatch(/,=HYPERLINK/);
  });

  it('is staff only: exhibitors get 403, anonymous 401', async () => {
    expect((await exportCsv('exhibitor')).statusCode).toBe(403);
    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${event.id}/reservations/export`,
      headers: { 'x-tenant-id': M.tenant },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('is tenant-scoped: another organization sees a 404', async () => {
    expect((await exportCsv('foreign')).statusCode).toBe(404);
    expect((await exportCsv('operator', 'not-a-uuid')).statusCode).toBe(404);
    expect((await exportCsv('operator', randomUUID())).statusCode).toBe(404);
  });
});

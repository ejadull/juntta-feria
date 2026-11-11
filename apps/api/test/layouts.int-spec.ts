import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { hashPassword } from '../src/auth/password.js';
import { DatabaseService } from '../src/db/database.service.js';
import { startIntApp } from './int.app.js';
import { ownerTestUrl } from './int.env.js';

/**
 * LAY-01 against a real PostgreSQL/PostGIS: templates, versioned drafts, server-side INV-04
 * validation on publish (§3.4), immutability of published versions (INV-06) and RLS.
 */

const PASSWORD = 'layouts test password';
const L_A = 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4';
const L_B = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5';
const VENUE_A = 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6';
const VENUE_B = 'a7a7a7a7-a7a7-4a7a-8a7a-a7a7a7a7a7a7';

let app: NestFastifyApplication;
let database: DatabaseService;
const tokens = { owner: '', operator: '' };

async function seed(): Promise<void> {
  const client = new pg.Client({ connectionString: ownerTestUrl() });
  await client.connect();
  try {
    const hash = await hashPassword(PASSWORD);
    await client.query(
      `INSERT INTO tenants (id, slug, name) VALUES ($1, 'layouts-a', 'Layouts A'), ($2, 'layouts-b', 'Layouts B')`,
      [L_A, L_B],
    );
    await client.query(
      `INSERT INTO venues (id, tenant_id, type, name, timezone, width_m, height_m) VALUES
         ($1, $3, 'FIXED', 'Galpón', 'America/Argentina/Buenos_Aires', 40, 20),
         ($2, $4, 'FIXED', 'Ajeno', 'America/Argentina/Buenos_Aires', 10, 10)`,
      [VENUE_A, VENUE_B, L_A, L_B],
    );
    const { rows } = await client.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash) VALUES ('owner@layouts.test', $1), ('operator@layouts.test', $1)
       RETURNING id, email`,
      [hash],
    );
    const id = (email: string) => rows.find((r) => r.email === email)!.id;
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $3, 'OWNER'), ($2, $3, 'OWNER'), ($1, $4, 'OPERATOR')`,
      [L_A, L_B, id('owner@layouts.test'), id('operator@layouts.test')],
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

beforeAll(async () => {
  await seed();
  app = await startIntApp();
  database = app.get(DatabaseService);
  tokens.owner = await login('owner@layouts.test');
  tokens.operator = await login('operator@layouts.test');
}, 60_000);

afterAll(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  who: keyof typeof tokens = 'operator',
  tenant = L_A,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${tokens[who]}`, 'x-tenant-id': tenant },
    ...(payload ? { payload } : {}),
  });

/** Axis-aligned rectangle as the editor persists it (LUI-05 D2): closed CCW ring in meters. */
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

const object = (
  kind: string,
  code: string | null,
  geometry: object,
  id: string = randomUUID(),
) => ({ id, kind, code, geometry, metadata: {} });

describe('layouts (LAY-01)', () => {
  let templateId = '';
  let v1 = '';

  it('creates a template with a first draft sized like its venue', async () => {
    const res = await call('POST', '/layout-templates', 'operator', L_A, {
      name: 'Plano galpón',
      venueId: VENUE_A,
    });
    expect(res.statusCode).toBe(201);
    const version = res.json();
    expect(version).toMatchObject({
      version: 1,
      status: 'DRAFT',
      widthM: 40,
      heightM: 20,
      publishedAt: null,
      objects: [],
    });
    templateId = version.templateId;
    v1 = version.id;
  });

  it('refuses a venue of another tenant and a template without size', async () => {
    const foreign = await call('POST', '/layout-templates', 'operator', L_A, {
      name: 'Robado',
      venueId: VENUE_B,
    });
    expect(foreign.statusCode).toBe(404);
    const sizeless = await call('POST', '/layout-templates', 'operator', L_A, {
      name: 'Sin medidas',
    });
    expect(sizeless.statusCode).toBe(400);
    const free = await call('POST', '/layout-templates', 'operator', L_A, {
      name: 'Itinerante',
      widthM: 30,
      heightM: 15,
    });
    expect(free.statusCode).toBe(201);
  });

  it('lists the tenant templates with their versions', async () => {
    const res = await call('GET', '/layout-templates');
    expect(res.statusCode).toBe(200);
    const plano = res.json().find((t: { id: string }) => t.id === templateId);
    expect(plano).toMatchObject({
      name: 'Plano galpón',
      venueId: VENUE_A,
      versions: [{ id: v1, version: 1, status: 'DRAFT' }],
    });
    expect(
      (await call('GET', '/layout-templates', 'owner', L_B)).json(),
    ).toEqual([]);
  });

  it.each([
    [
      'open ring',
      {
        ...object('STAND', 'A1', rect(0, 0, 2, 2)),
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [2, 0],
              [2, 2],
              [0, 2],
            ],
          ],
        },
      },
    ],
    ['unknown kind', object('BAR', 'X', rect(0, 0, 2, 2))],
    [
      'non numeric point',
      {
        ...object('STAND', 'A1', rect(0, 0, 2, 2)),
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              ['a', 0],
              [2, 2],
              [0, 0],
            ],
          ],
        },
      },
    ],
    [
      'malformed id',
      { ...object('STAND', 'A1', rect(0, 0, 2, 2)), id: 'stand-1' },
    ],
  ])('rejects a draft with %s (400)', async (_case, bad) => {
    const res = await call(
      'PUT',
      `/layout-versions/${v1}/objects`,
      'operator',
      L_A,
      { objects: [bad] },
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects duplicate object ids in one draft (400)', async () => {
    const id = randomUUID();
    const res = await call(
      'PUT',
      `/layout-versions/${v1}/objects`,
      'operator',
      L_A,
      {
        objects: [
          object('STAND', 'A1', rect(0, 0, 2, 2), id),
          object('STAND', 'A2', rect(3, 0, 2, 2), id),
        ],
      },
    );
    expect(res.statusCode).toBe(400);
  });

  it('saves an invalid draft (editing in progress) and refuses to publish it with every issue (422)', async () => {
    const overlapA = object('STAND', 'A1', rect(0, 0, 4, 4));
    const overlapB = object('STAND', 'A2', rect(2, 2, 4, 4));
    const outside = object('STAND', 'A3', rect(38, 0, 4, 4));
    const noCode = object('STAND', null, rect(10, 0, 2, 2));
    const dupA = object('STAND', 'B1', rect(14, 0, 2, 2));
    const dupB = object('STAND', 'B1', rect(17, 0, 2, 2));
    const aisle = object('AISLE', null, rect(0, 10, 40, 2));
    const onAisle = object('STAND', 'C1', rect(20, 9, 2, 2));
    const bowtie = object('OBSTACLE', null, {
      type: 'Polygon',
      coordinates: [
        [
          [25, 0],
          [27, 2],
          [27, 0],
          [25, 2],
          [25, 0],
        ],
      ],
    });
    const objects = [
      overlapA,
      overlapB,
      outside,
      noCode,
      dupA,
      dupB,
      aisle,
      onAisle,
      bowtie,
    ];

    const saved = await call(
      'PUT',
      `/layout-versions/${v1}/objects`,
      'operator',
      L_A,
      { objects },
    );
    expect(saved.statusCode).toBe(200);
    expect(saved.json().objects).toHaveLength(objects.length);

    const res = await call('POST', `/layout-versions/${v1}/publish`, 'owner');
    expect(res.statusCode).toBe(422);
    const issues: { code: string; objectIds: string[] }[] = res.json().issues;
    const ids = (code: string) =>
      issues.filter((i) => i.code === code).map((i) => [...i.objectIds].sort());
    expect(ids('STAND_OVERLAP')).toEqual([[overlapA.id, overlapB.id].sort()]);
    expect(ids('OUT_OF_BOUNDS')).toEqual([[outside.id]]);
    expect(ids('CODE_MISSING')).toEqual([[noCode.id]]);
    expect(ids('CODE_DUPLICATE')).toEqual([[dupA.id, dupB.id].sort()]);
    expect(ids('STAND_ON_RESERVED')).toEqual([[aisle.id, onAisle.id].sort()]);
    expect(ids('INVALID_GEOMETRY')).toEqual([[bowtie.id]]);
  });

  it('reports NO_STANDS for a layout without stands', async () => {
    await call('PUT', `/layout-versions/${v1}/objects`, 'operator', L_A, {
      objects: [object('ENTRY', null, rect(0, 0, 2, 1))],
    });
    const res = await call('POST', `/layout-versions/${v1}/publish`, 'owner');
    expect(res.statusCode).toBe(422);
    expect(res.json().issues.map((i: { code: string }) => i.code)).toEqual([
      'NO_STANDS',
    ]);
  });

  const a1 = object('STAND', 'A1', rect(0, 0, 3, 3));
  const a2 = object('STAND', 'A2', rect(3, 0, 3, 3)); // shares an edge with A1: valid

  it('round-trips geometry exactly and publishes a valid draft (owner only)', async () => {
    const saved = await call(
      'PUT',
      `/layout-versions/${v1}/objects`,
      'operator',
      L_A,
      {
        objects: [a1, a2, object('AISLE', null, rect(0, 3, 6, 1.5))],
      },
    );
    expect(
      saved.json().objects.find((o: { id: string }) => o.id === a1.id),
    ).toEqual(a1);

    expect(
      (await call('POST', `/layout-versions/${v1}/publish`, 'operator'))
        .statusCode,
    ).toBe(403);
    const res = await call('POST', `/layout-versions/${v1}/publish`, 'owner');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'PUBLISHED',
      publishedAt: expect.any(String),
    });
  });

  it('keeps a published version immutable, in the API and in the database', async () => {
    const res = await call(
      'PUT',
      `/layout-versions/${v1}/objects`,
      'operator',
      L_A,
      { objects: [a1] },
    );
    expect(res.statusCode).toBe(409);
    expect(
      (await call('POST', `/layout-versions/${v1}/publish`, 'owner'))
        .statusCode,
    ).toBe(409);
    await expect(
      database.withTenant(L_A, (tx) =>
        tx.execute(
          sql`UPDATE layout_objects SET code = 'Z9' WHERE layout_version_id = ${v1}`,
        ),
      ),
    ).rejects.toBeDefined();
    await expect(
      database.withTenant(L_A, (tx) =>
        tx.execute(
          sql`UPDATE layout_versions SET width_m = 99 WHERE id = ${v1}`,
        ),
      ),
    ).rejects.toBeDefined();
  });

  let v2 = '';

  it('clones a version into the next draft keeping object ids, one draft at a time', async () => {
    const res = await call(
      'POST',
      `/layout-templates/${templateId}/versions`,
      'operator',
      L_A,
      {
        sourceVersionId: v1,
      },
    );
    expect(res.statusCode).toBe(201);
    const draft = res.json();
    expect(draft).toMatchObject({
      version: 2,
      status: 'DRAFT',
      widthM: 40,
      heightM: 20,
    });
    expect(draft.objects.map((o: { id: string }) => o.id).sort()).toContain(
      a1.id,
    );
    v2 = draft.id;

    const again = await call(
      'POST',
      `/layout-templates/${templateId}/versions`,
      'operator',
      L_A,
      {
        sourceVersionId: v1,
      },
    );
    expect(again.statusCode).toBe(409);
  });

  it('archives the previous published version when the next one is published', async () => {
    expect(
      (await call('POST', `/layout-versions/${v2}/publish`, 'owner'))
        .statusCode,
    ).toBe(200);
    expect((await call('GET', `/layout-versions/${v1}`)).json().status).toBe(
      'ARCHIVED',
    );
  });

  describe('cloning a plan into a new template', () => {
    const cloneInto = (
      id: string,
      payload: object,
      who: keyof typeof tokens = 'operator',
      tenant = L_A,
    ) => call('POST', `/layout-templates/${id}/clone`, who, tenant, payload);

    it('copies an archived version into a new draft with new object ids and the same geometry', async () => {
      const source = (await call('GET', `/layout-versions/${v1}`)).json();
      expect(source.status).toBe('ARCHIVED');

      const res = await cloneInto(templateId, {
        name: 'Plano galpón (copia)',
        sourceVersionId: v1,
      });
      expect(res.statusCode).toBe(201);
      const copy = res.json();
      expect(copy).toMatchObject({
        version: 1,
        status: 'DRAFT',
        widthM: 40,
        heightM: 20,
        publishedAt: null,
      });
      expect(copy.templateId).not.toBe(templateId);
      expect(copy.objects).toHaveLength(source.objects.length);
      const shape = (o: {
        kind: string;
        code: string | null;
        geometry: unknown;
      }) => JSON.stringify([o.kind, o.code, o.geometry]);
      expect(copy.objects.map(shape).sort()).toEqual(
        source.objects.map(shape).sort(),
      );
      const sourceIds = new Set(
        source.objects.map((o: { id: string }) => o.id),
      );
      expect(
        copy.objects.some((o: { id: string }) => sourceIds.has(o.id)),
      ).toBe(false);

      // The source plan is untouched and the new template is listed with its venue.
      const after = (await call('GET', `/layout-versions/${v1}`)).json();
      expect(after).toEqual(source);
      const list = (await call('GET', '/layout-templates')).json() as {
        id: string;
        name: string;
        venueId: string | null;
        versions: { status: string }[];
      }[];
      expect(list.find((t) => t.id === templateId)!.versions).toHaveLength(2);
      expect(list.find((t) => t.id === copy.templateId)).toMatchObject({
        name: 'Plano galpón (copia)',
        venueId: VENUE_A,
      });
    });

    it('can start from the published version and gets its own editable draft', async () => {
      const res = await cloneInto(templateId, {
        name: 'Otra copia',
        sourceVersionId: v2,
        venueId: VENUE_A,
      });
      expect(res.statusCode).toBe(201);
      const draft = res.json();
      const saved = await call(
        'PUT',
        `/layout-versions/${draft.id}/objects`,
        'operator',
        L_A,
        { objects: [] },
      );
      expect(saved.statusCode).toBe(200);
      expect(
        (await call('GET', `/layout-versions/${v2}`)).json().objects,
      ).not.toHaveLength(0);
    });

    it('keeps names unique (409) and validates the body (400)', async () => {
      expect(
        (
          await cloneInto(templateId, {
            name: 'plano galpón (COPIA)',
            sourceVersionId: v1,
          })
        ).statusCode,
      ).toBe(409);
      for (const bad of [
        { sourceVersionId: v1 },
        { name: '  ', sourceVersionId: v1 },
        { name: 'X', sourceVersionId: 'nope' },
        { name: 'X', sourceVersionId: v1, venueId: 'nope' },
        { name: 'X', sourceVersionId: v1, extra: true },
      ])
        expect((await cloneInto(templateId, bad)).statusCode).toBe(400);
    });

    it('hides other tenants: foreign template, version and venue are 404', async () => {
      expect(
        (
          await cloneInto(
            templateId,
            { name: 'Robado', sourceVersionId: v1 },
            'owner',
            L_B,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await cloneInto(templateId, {
            name: 'Venue ajeno',
            sourceVersionId: v1,
            venueId: VENUE_B,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await cloneInto(templateId, {
            name: 'Version ajena',
            sourceVersionId: randomUUID(),
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await cloneInto('nope', { name: 'Y', sourceVersionId: v1 }))
          .statusCode,
      ).toBe(404);
    });
  });

  it('hides versions and templates of other tenants (404)', async () => {
    expect(
      (await call('GET', `/layout-versions/${v1}`, 'owner', L_B)).statusCode,
    ).toBe(404);
    expect(
      (await call('GET', '/layout-versions/nope', 'owner', L_A)).statusCode,
    ).toBe(404);
    const clone = await call(
      'POST',
      `/layout-templates/${templateId}/versions`,
      'owner',
      L_B,
      {
        sourceVersionId: v2,
      },
    );
    expect(clone.statusCode).toBe(404);
  });

  it('refuses to delete a venue used by a template (409)', async () => {
    const res = await call('DELETE', `/venues/${VENUE_A}`, 'owner');
    expect(res.statusCode).toBe(409);
  });

  it('keeps layout tables invisible outside a tenant transaction (RLS)', async () => {
    for (const table of [
      'layout_templates',
      'layout_versions',
      'layout_objects',
    ]) {
      const { rows } = await database.db.execute(
        sql.raw(`SELECT 1 FROM ${table}`),
      );
      expect(rows).toEqual([]);
    }
  });
});

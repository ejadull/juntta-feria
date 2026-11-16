#!/usr/bin/env node
// DEV ONLY. Seeds demo editions of "Ritual Cipolletti" into an organization: the venue, one
// published plan per edition (32 stands in four sectors), the event, nine exhibitors with confirmed
// stands. Data comes from the public press material for the festival; exhibitor descriptions are
// placeholders. Needs the OWNER connection, so run it through the db-migrate service:
//   docker compose run --rm --no-deps db-migrate node apps/api/scripts/seed-ritual-demo.mjs
//     [--organizer you@gmail.com]
// Idempotent per edition: an edition whose slug already exists is skipped. Never prints secrets.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const TIMEZONE = 'America/Argentina/Buenos_Aires';
const CURRENCY = 'ARS';
const EMAIL = /^[^@\s]+@[^@\s]+$/;

// Two days per edition, 12 a 23 h in Argentina (UTC-3), starting on the chosen date.
const EDITIONS = [
  {
    slug: 'ritual-cipolletti-2026-11-30-v1',
    name: 'Ritual Cipolletti · 30/11 (versión 1)',
    startsAt: '2026-11-30T15:00:00Z',
    endsAt: '2026-12-02T02:00:00Z',
  },
  {
    slug: 'ritual-cipolletti-2026-11-30-v2',
    name: 'Ritual Cipolletti · 30/11 (versión 2)',
    startsAt: '2026-11-30T15:00:00Z',
    endsAt: '2026-12-02T02:00:00Z',
  },
  {
    slug: 'ritual-cipolletti-2026-12-15-v3',
    name: 'Ritual Cipolletti · 15/12 (versión 3)',
    startsAt: '2026-12-15T15:00:00Z',
    endsAt: '2026-12-17T02:00:00Z',
  },
];

const VENUE = {
  name: 'Parque Rosauer',
  address: 'Blas Parera 487, Cipolletti, Río Negro',
  widthM: 110,
  heightM: 70,
};

function fail(message) {
  console.error(`seed-ritual-demo: ${message}`);
  process.exit(1);
}

function assertNotProduction(env) {
  if (env.NODE_ENV === 'production') fail('refusing to run with NODE_ENV=production.');
  if (env.MP_ENVIRONMENT && env.MP_ENVIRONMENT !== 'sandbox')
    fail('refusing to run unless MP_ENVIRONMENT is sandbox.');
}

function parseArgs(argv) {
  const options = { organizer: 'jadulled@gmail.com' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--organizer') {
      const email = (argv[(i += 1)] ?? '').trim().toLowerCase();
      if (!EMAIL.test(email)) fail('--organizer needs a valid email address.');
      options.organizer = email;
    } else fail(`Unknown argument ${argv[i]}.`);
  }
  return options;
}

// Planar meters (SRID 0), as the layout editor stores them. Lanes are kept clear between blocks.
function rect(x, y, w, h) {
  return {
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
  };
}

// Sectors and their stands. Prices in ARS; stored in cents, as the API does.
const SECTORS = [
  {
    name: 'Foodtrucks gastronómicos',
    sortOrder: 1,
    priceArs: 350_000,
    stands: Array.from({ length: 8 }, (_, i) => ({
      code: `F${i + 1}`,
      geometry: rect(4, 8 + i * 6, 7, 5),
    })),
  },
  {
    name: 'Stands gastronómicos',
    sortOrder: 2,
    priceArs: 180_000,
    stands: Array.from({ length: 12 }, (_, i) => ({
      code: `G${i + 1}`,
      geometry: rect(20 + (i % 6) * 9, 8 + Math.floor(i / 6) * 8, 7, 6),
    })),
  },
  {
    name: 'Mercado de productores',
    sortOrder: 3,
    priceArs: 220_000,
    stands: Array.from({ length: 6 }, (_, i) => ({
      code: `P${i + 1}`,
      geometry: rect(20 + (i % 3) * 11, 40 + Math.floor(i / 3) * 9, 9, 7),
    })),
  },
  {
    name: 'Bodegas y sidreras',
    sortOrder: 4,
    priceArs: 200_000,
    stands: Array.from({ length: 6 }, (_, i) => ({
      code: `B${i + 1}`,
      geometry: rect(78 + (i % 3) * 9, 40 + Math.floor(i / 3) * 9, 8, 7),
    })),
  },
];

const UTILITIES = [
  { kind: 'ENTRY', code: 'Ingreso Blas Parera', geometry: rect(0, 30, 3, 8) },
  { kind: 'ENTRY', code: 'Ingreso Avenida', geometry: rect(104, 30, 3, 8) },
  { kind: 'UTILITY', code: 'Escenario', geometry: rect(40, 60, 14, 8) },
  { kind: 'UTILITY', code: 'Baños', geometry: rect(66, 60, 6, 6) },
];

// Exhibitors that hold a confirmed stand. Descriptions are short placeholders, not claims.
const EXHIBITORS = [
  { stand: 'F1', trade: 'Nuevo Puerto Fish Truck', category: 'Gastronomía', description: 'Pescados y mariscos rionegrinos, preparados en el momento.' },
  { stand: 'F2', trade: 'Caos Burgers', category: 'Gastronomía', description: 'Hamburguesas de cocina callejera.' },
  { stand: 'G1', trade: 'Nihilista Cerveza Artesanal', category: 'Bodegas y bebidas', description: 'Cerveza artesanal para la feria.' },
  { stand: 'G2', trade: 'Cortez', category: 'Gastronomía', description: 'Cocina de estación con ingredientes regionales.' },
  { stand: 'P1', trade: 'Chacra Agroecológica El Origen', category: 'Productores', description: 'Producción agroecológica de la chacra a la mesa.' },
  { stand: 'P2', trade: 'Quesería Ventimiglia', category: 'Productores', description: 'Quesos de elaboración artesanal.' },
  { stand: 'P3', trade: 'Keto del Valle', category: 'Productores', description: 'Alimentos para distintos tipos de alimentación.' },
  { stand: 'B1', trade: 'Bodega Malma', category: 'Bodegas y bebidas', description: 'Vinos de la región.' },
  { stand: 'B2', trade: 'Gennari', category: 'Bodegas y bebidas', description: 'Vinos y sidra de una familia productora de Fernández Oro.' },
];

async function findOrganization(client, email) {
  const { rows } = await client.query(
    `SELECT m.tenant_id FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE lower(u.email) = $1 AND m.role = 'OWNER' AND m.status = 'ACTIVE' LIMIT 1`,
    [email],
  );
  if (!rows[0]) fail(`no active OWNER membership for ${email}.`);
  return rows[0].tenant_id;
}

async function ensureVenue(client, tenantId) {
  const found = await client.query('SELECT id FROM venues WHERE tenant_id = $1 AND name = $2', [
    tenantId,
    VENUE.name,
  ]);
  if (found.rows[0]) return found.rows[0].id;
  const { rows } = await client.query(
    `INSERT INTO venues (tenant_id, type, name, address, timezone, width_m, height_m)
     VALUES ($1, 'FIXED', $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, VENUE.name, VENUE.address, TIMEZONE, VENUE.widthM, VENUE.heightM],
  );
  return rows[0].id;
}

async function ensureUser(client, email) {
  const found = await client.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  if (found.rows[0]) return found.rows[0].id;
  const { rows } = await client.query(
    'INSERT INTO users (email, confirmed_at) VALUES ($1, now()) RETURNING id',
    [email],
  );
  return rows[0].id;
}

async function ensureCategory(client, tenantId, name) {
  const { rows } = await client.query(
    `INSERT INTO exhibitor_categories (tenant_id, name) VALUES ($1, $2)
     ON CONFLICT (tenant_id, lower(btrim(name))) DO UPDATE SET name = excluded.name
     RETURNING id`,
    [tenantId, name],
  );
  return rows[0].id;
}

/** One exhibitor per (organization, user): editions share the same exhibitors. */
async function ensureExhibitor(client, tenantId, item, index) {
  const userId = await ensureUser(client, `ritual-expositor-${index + 1}@ritual.demo.test`);
  const found = await client.query(
    'SELECT id FROM exhibitors WHERE tenant_id = $1 AND user_id = $2',
    [tenantId, userId],
  );
  if (found.rows[0]) return { userId, exhibitorId: found.rows[0].id };
  const categoryId = await ensureCategory(client, tenantId, item.category);
  const { rows } = await client.query(
    `INSERT INTO exhibitors (tenant_id, user_id, legal_name, trade_name, category_id, description,
                             public_contact_opt_in, public_consent_at)
     VALUES ($1, $2, $3, $3, $4, $5, true, now()) RETURNING id`,
    [tenantId, userId, item.trade, categoryId, item.description],
  );
  return { userId, exhibitorId: rows[0].id };
}

async function insertObject(client, tenantId, layoutVersionId, kind, code, geometry) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO layout_objects (id, tenant_id, layout_version_id, kind, code, geometry, metadata)
     VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_GeomFromGeoJSON($6), 0), '{}')`,
    [id, tenantId, layoutVersionId, kind, code, JSON.stringify(geometry)],
  );
  return id;
}

/** Draft plan first (objects only go into drafts), then published. One plan per edition. */
async function buildPlan(client, tenantId, venueId, edition) {
  const template = await client.query(
    'INSERT INTO layout_templates (tenant_id, venue_id, name) VALUES ($1, $2, $3) RETURNING id',
    [tenantId, venueId, `${edition.name} · plano`],
  );
  const version = await client.query(
    `INSERT INTO layout_versions (tenant_id, template_id, version, width_m, height_m, status)
     VALUES ($1, $2, 1, $3, $4, 'DRAFT') RETURNING id`,
    [tenantId, template.rows[0].id, VENUE.widthM, VENUE.heightM],
  );
  const layoutVersionId = version.rows[0].id;

  for (const utility of UTILITIES) {
    await insertObject(client, tenantId, layoutVersionId, utility.kind, utility.code, utility.geometry);
  }
  const standObjects = new Map();
  for (const sector of SECTORS) {
    for (const stand of sector.stands) {
      const objectId = await insertObject(client, tenantId, layoutVersionId, 'STAND', stand.code, stand.geometry);
      standObjects.set(stand.code, objectId);
    }
  }
  await client.query(
    `UPDATE layout_versions SET status = 'PUBLISHED', published_at = now() WHERE id = $1`,
    [layoutVersionId],
  );
  return { layoutVersionId, standObjects };
}

async function seedEdition(client, tenantId, venueId, edition) {
  const { layoutVersionId, standObjects } = await buildPlan(client, tenantId, venueId, edition);

  const event = await client.query(
    `INSERT INTO events (tenant_id, venue_id, layout_version_id, name, slug, starts_at, ends_at,
                         sales_open_at, sales_close_at, status, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $6, 'PUBLISHED', now()) RETURNING id`,
    [tenantId, venueId, layoutVersionId, edition.name, edition.slug, edition.startsAt, edition.endsAt],
  );
  const eventId = event.rows[0].id;

  const standIdByCode = new Map();
  for (const sector of SECTORS) {
    const row = await client.query(
      'INSERT INTO event_sectors (tenant_id, event_id, name, sort_order) VALUES ($1, $2, $3, $4) RETURNING id',
      [tenantId, eventId, sector.name, sector.sortOrder],
    );
    for (const stand of sector.stands) {
      const inserted = await client.query(
        `INSERT INTO event_stands (tenant_id, event_id, layout_version_id, layout_object_id, sector_id,
                                   code, status, price_cents, currency)
         VALUES ($1, $2, $3, $4, $5, $6, 'AVAILABLE', $7, $8) RETURNING id`,
        [tenantId, eventId, layoutVersionId, standObjects.get(stand.code), row.rows[0].id, stand.code,
          sector.priceArs * 100, CURRENCY],
      );
      standIdByCode.set(stand.code, { id: inserted.rows[0].id, priceCents: sector.priceArs * 100 });
    }
  }

  for (const [index, item] of EXHIBITORS.entries()) {
    const { userId, exhibitorId } = await ensureExhibitor(client, tenantId, item, index);
    const stand = standIdByCode.get(item.stand);
    await client.query(
      `INSERT INTO reservations (tenant_id, event_stand_id, exhibitor_id, user_id, status,
                                 price_cents, currency, terms_version, idempotency_key)
       VALUES ($1, $2, $3, $4, 'CONFIRMED', $5, $6, 'demo-ritual-2026', $7)`,
      [tenantId, stand.id, exhibitorId, userId, stand.priceCents, CURRENCY, randomUUID()],
    );
    await client.query(`UPDATE event_stands SET status = 'ASSIGNED', updated_at = now() WHERE id = $1`, [
      stand.id,
    ]);
  }
}

async function main() {
  assertNotProduction(process.env);
  const url = (process.env.DATABASE_MIGRATION_URL ?? '').trim();
  if (!url) fail('DATABASE_MIGRATION_URL is required (run it via the db-migrate service).');
  const options = parseArgs(process.argv.slice(2));
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const tenantId = await findOrganization(client, options.organizer);
    const venueId = await ensureVenue(client, tenantId);
    for (const edition of EDITIONS) {
      const existing = await client.query('SELECT id FROM events WHERE slug = $1', [edition.slug]);
      if (existing.rows[0]) {
        console.log(`Ya existe ${edition.slug}; se omite.`);
        continue;
      }
      await client.query('BEGIN');
      await seedEdition(client, tenantId, venueId, edition);
      await client.query('COMMIT');
      console.log(`Creado: ${edition.name} (/ferias/${edition.slug})`);
    }
    console.log(`Organización del organizador: ${options.organizer}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    fail(`failed (${error?.code ?? error?.name ?? 'unknown error'}: ${error?.message ?? ''}).`);
  } finally {
    await client.end();
  }
}

assertNotProduction(process.env);
await main();

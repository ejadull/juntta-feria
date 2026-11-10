#!/usr/bin/env node
// DEV ONLY. Seeds what the HTTP API cannot create yet (tenant, users, subscription), mirroring
// seed() in test/checkout.int-spec.ts, and writes .sandbox-state.json for sandbox-checkout.mjs.
// Needs the OWNER connection, so run it through the db-migrate service:
//   docker compose run --rm --no-deps db-migrate node apps/api/scripts/bootstrap-sandbox.mjs [--no-subscription]
// By default the exhibitor gets an ACTIVE platform subscription (shortcut). With --no-subscription it
// does not, so the real flow (sandbox-checkout.mjs subscribe) can be tested.
// Never prints connection strings.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const STATE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '.sandbox-state.json',
);
// Same Argon2id profile as src/auth/password.ts.
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const SUBSCRIPTION_DAYS = 30;
const DAY_MS = 86_400_000;

function fail(message) {
  console.error(`bootstrap-sandbox: ${message}`);
  process.exit(1);
}

function assertNotProduction(env) {
  if (env.NODE_ENV === 'production')
    fail('refusing to run with NODE_ENV=production.');
  if (env.MP_ENVIRONMENT && env.MP_ENVIRONMENT !== 'sandbox')
    fail('refusing to run unless MP_ENVIRONMENT is sandbox.');
}

function newRun() {
  const run = Date.now().toString(36);
  const password = randomBytes(9).toString('base64url');
  return {
    run,
    slug: `sandbox-${run}`,
    owner: { email: `organizador-${run}@sandbox.test`, password },
    exhibitor: { email: `feriante-${run}@sandbox.test`, password },
  };
}

async function insertUser(client, email, passwordHash) {
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, confirmed_at) VALUES ($1, $2, now()) RETURNING id`,
    [email, passwordHash],
  );
  return rows[0].id;
}

async function seed(client, plan, withSubscription) {
  const passwordHash = await hash(plan.owner.password, ARGON2);
  const tenant = await client.query(
    `INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id`,
    [plan.slug, `Sandbox ${plan.run}`],
  );
  const tenantId = tenant.rows[0].id;
  const venue = await client.query(
    `INSERT INTO venues (tenant_id, type, name, timezone, width_m, height_m)
     VALUES ($1, 'FIXED', 'Predio sandbox', 'America/Argentina/Buenos_Aires', 30, 20) RETURNING id`,
    [tenantId],
  );
  const ownerId = await insertUser(client, plan.owner.email, passwordHash);
  await client.query(
    `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
    [tenantId, ownerId],
  );
  const exhibitorId = await insertUser(
    client,
    plan.exhibitor.email,
    passwordHash,
  );
  await client.query(
    `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'EXHIBITOR')`,
    [tenantId, exhibitorId],
  );
  await client.query(
    `INSERT INTO exhibitors (tenant_id, user_id, legal_name, trade_name, tax_id, category)
     VALUES ($1, $2, 'Feriante Sandbox', 'Feriante Sandbox', '20123456786', 'Textiles')`,
    [tenantId, exhibitorId],
  );
  if (withSubscription)
    await client.query(
      `INSERT INTO platform_subscriptions (user_id, status, current_period_end) VALUES ($1, 'ACTIVE', $2)`,
      [exhibitorId, new Date(Date.now() + SUBSCRIPTION_DAYS * DAY_MS)],
    );
  return { tenantId, venueId: venue.rows[0].id };
}

async function main() {
  assertNotProduction(process.env);
  const url = (process.env.DATABASE_MIGRATION_URL ?? '').trim();
  if (!url)
    fail(
      'DATABASE_MIGRATION_URL is required (run it via the db-migrate service).',
    );
  const plan = newRun();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const ids = await seed(
      client,
      plan,
      !process.argv.includes('--no-subscription'),
    );
    await client.query('COMMIT');
    const state = {
      createdAt: new Date().toISOString(),
      slug: plan.slug,
      ...ids,
      owner: plan.owner,
      exhibitor: plan.exhibitor,
    };
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`Tenant: ${ids.tenantId} (${plan.slug})`);
    console.log(`Organizador: ${plan.owner.email} / ${plan.owner.password}`);
    console.log(
      `Feriante:    ${plan.exhibitor.email} / ${plan.exhibitor.password}`,
    );
    console.log('Estado guardado en apps/api/scripts/.sandbox-state.json');
    if (process.argv.includes('--no-subscription'))
      console.log(
        'Sin suscripcion: corre sandbox-checkout.mjs subscribe <email del comprador de prueba> antes de setup.',
      );
    else
      console.log(
        'Siguiente: docker compose exec api node apps/api/scripts/sandbox-checkout.mjs setup',
      );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    fail(
      `failed (${error?.code ?? error?.name ?? 'unknown error'}: ${error?.message ?? ''}).`,
    );
  } finally {
    await client.end();
  }
}

await main();

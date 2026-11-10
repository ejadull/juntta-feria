#!/usr/bin/env node
// DEV ONLY. Seeds what the HTTP API cannot create yet (tenant, users, subscription), mirroring
// seed() in test/checkout.int-spec.ts, and writes .sandbox-state.json for sandbox-checkout.mjs.
// Needs the OWNER connection, so run it through the db-migrate service:
//   docker compose run --rm --no-deps db-migrate node apps/api/scripts/bootstrap-sandbox.mjs //     [--organizer you@gmail.com] [--exhibitor other@gmail.com] [--no-subscription]
// Sign-in is Google-only (ADR 0008): users are created WITHOUT a password and bind to their Google
// account on their first Google sign-in. Pass real Google emails to be able to sign in on the web;
// without them fictitious @sandbox.test users are created (usable only by sandbox-checkout.mjs).
// By default the exhibitor gets an ACTIVE platform subscription (shortcut). With --no-subscription it
// does not, so the real flow (sandbox-checkout.mjs subscribe) can be tested.
// Never prints connection strings.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const STATE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '.sandbox-state.json',
);
const EMAIL = /^[^@s]+@[^@s]+$/;
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

/** --organizer / --exhibitor <email>: the Google accounts that will sign in as those users. */
function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-subscription') options.noSubscription = true;
    else if (arg === '--organizer' || arg === '--exhibitor') {
      const email = (argv[(i += 1)] ?? '').trim().toLowerCase();
      if (!EMAIL.test(email) || email.length > 254)
        fail(`${arg} needs a valid email address.`);
      options[arg.slice(2)] = email;
    } else fail(`Unknown argument ${arg}.`);
  }
  return options;
}

function newRun(options) {
  const run = Date.now().toString(36);
  const fictitious = (role) => `${role}-${run}@sandbox.test`;
  return {
    run,
    slug: `sandbox-${run}`,
    owner: { email: options.organizer ?? fictitious('organizador') },
    exhibitor: { email: options.exhibitor ?? fictitious('feriante') },
    fictitious: !options.organizer || !options.exhibitor,
  };
}

/** Pending user (no password, no Google subject yet); an existing account is reused. */
async function ensureUser(client, email) {
  const found = await client.query(
    'SELECT id FROM users WHERE lower(email) = $1',
    [email],
  );
  if (found.rows[0]) return found.rows[0].id;
  const { rows } = await client.query(
    `INSERT INTO users (email, confirmed_at) VALUES ($1, now()) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function seed(client, plan, withSubscription) {
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
  const ownerId = await ensureUser(client, plan.owner.email);
  await client.query(
    `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
    [tenantId, ownerId],
  );
  const exhibitorId = await ensureUser(client, plan.exhibitor.email);
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
  return { tenantId, venueId: venue.rows[0].id, ownerId, exhibitorId };
}

async function main() {
  assertNotProduction(process.env);
  const url = (process.env.DATABASE_MIGRATION_URL ?? '').trim();
  if (!url)
    fail(
      'DATABASE_MIGRATION_URL is required (run it via the db-migrate service).',
    );
  const options = parseArgs(process.argv.slice(2));
  const plan = newRun(options);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    const ids = await seed(client, plan, !options.noSubscription);
    await client.query('COMMIT');
    const { ownerId, exhibitorId, ...rest } = ids;
    const state = {
      createdAt: new Date().toISOString(),
      slug: plan.slug,
      ...rest,
      owner: { ...plan.owner, id: ownerId },
      exhibitor: { ...plan.exhibitor, id: exhibitorId },
    };
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`Tenant: ${ids.tenantId} (${plan.slug})`);
    console.log(`Organizador: ${plan.owner.email}`);
    console.log(`Feriante:    ${plan.exhibitor.email}`);
    if (plan.fictitious)
      console.log(
        'Aviso: los usuarios @sandbox.test no pueden ingresar en la web (solo Google). Pasa --organizer y --exhibitor con emails de Google para poder hacerlo; sandbox-checkout.mjs funciona igual.',
      );
    console.log('Estado guardado en apps/api/scripts/.sandbox-state.json');
    if (options.noSubscription)
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

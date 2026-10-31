#!/usr/bin/env node
// CORE-01: creates/updates the application role and applies the Drizzle migrations.
// Runs with the OWNER connection (DATABASE_MIGRATION_URL); the API never gets that role.
// Usage: npm run db:setup --workspace api   (Compose runs it as the `db-migrate` service)
// Prints role and migration info only; never URLs, users' passwords or other values.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const APP_ROLE = 'juntta_app';
const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');
const MIN_PASSWORD_LENGTH = 16;

function fail(message) {
  console.error(`db:setup: ${message}`);
  process.exit(1);
}

function readConfig(env) {
  const migrationUrl = (env.DATABASE_MIGRATION_URL ?? '').trim();
  const appPassword = (env.APP_DB_PASSWORD ?? '').trim();
  if (!migrationUrl) fail('DATABASE_MIGRATION_URL is required (owner role, migrations only).');
  try {
    if (!['postgres:', 'postgresql:'].includes(new URL(migrationUrl).protocol)) throw new Error();
  } catch {
    fail('DATABASE_MIGRATION_URL must be a postgres(ql):// URL.');
  }
  if (appPassword.length < MIN_PASSWORD_LENGTH)
    fail(`APP_DB_PASSWORD is required (at least ${MIN_PASSWORD_LENGTH} characters).`);
  return { migrationUrl, appPassword };
}

/** Idempotent: creates the role or realigns its attributes and password. */
async function ensureAppRole(client, password) {
  const attributes = 'LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION';
  const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
  // Role DDL takes no bind parameters: identifier and literal are escaped by the driver.
  const verb = rowCount ? 'ALTER' : 'CREATE';
  await client.query(
    `${verb} ROLE ${client.escapeIdentifier(APP_ROLE)} ${attributes} PASSWORD ${client.escapeLiteral(password)}`,
  );
  const { rows } = await client.query('SELECT current_database() AS db');
  await client.query(
    `GRANT CONNECT ON DATABASE ${client.escapeIdentifier(rows[0].db)} TO ${client.escapeIdentifier(APP_ROLE)}`,
  );
  return rowCount ? 'updated' : 'created';
}

export async function setupDatabase({ migrationUrl, appPassword }) {
  const client = new pg.Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    const role = await ensureAppRole(client, appPassword);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    const { rows } = await client.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
    return { role, migrations: rows[0].n };
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = readConfig(process.env);
  setupDatabase(config).then(
    ({ role, migrations }) =>
      console.log(`db:setup: role ${APP_ROLE} ${role}; ${migrations} migrations applied.`),
    // Driver errors can quote connection details: report only their code/class.
    (error) => fail(`failed (${error?.code ?? error?.name ?? 'unknown error'}).`),
  );
}

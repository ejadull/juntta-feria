#!/usr/bin/env node
// CORE-04: bootstraps the FIRST platform administrator (nobody can call the API before one exists).
// Runs with the OWNER connection (DATABASE_MIGRATION_URL), like db-setup.mjs.
// Usage (from the repo root):
//   docker compose run --rm --no-deps db-migrate node apps/api/scripts/create-platform-admin.mjs \
//     --email admin@example.com --name "Ada Admin" --password "<at least 12 characters>"
// Idempotent: an existing account is only promoted (its password is NOT changed).
// Refuses NODE_ENV=production unless --allow-production is passed. Never prints the password.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

// Same Argon2id profile as src/auth/password.ts (OWASP minimum).
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const MIN_PASSWORD_LENGTH = 12;
const EMAIL = /^[^@\s]+@[^@\s]+$/;

function fail(message) {
  console.error(`create-platform-admin: ${message}`);
  process.exit(1);
}

export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--allow-production') options.allowProduction = true;
    else if (['--email', '--name', '--password'].includes(arg)) {
      const value = argv[(i += 1)];
      if (value === undefined || value.startsWith('--'))
        throw new Error(`${arg} needs a value.`);
      options[arg.slice(2)] = value;
    } else throw new Error(`Unknown argument ${arg}.`);
  }
  return options;
}

export function validate(options, env) {
  if (env.NODE_ENV === 'production' && !options.allowProduction)
    throw new Error(
      'refusing to run with NODE_ENV=production without --allow-production.',
    );
  const email = (options.email ?? '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254)
    throw new Error('--email must be a valid email address.');
  const name = (options.name ?? '').trim();
  if (!name || name.length > 120)
    throw new Error('--name is required (max 120 characters).');
  const password = options.password ?? '';
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 256)
    throw new Error(
      `--password must have ${MIN_PASSWORD_LENGTH} to 256 characters.`,
    );
  const url = (env.DATABASE_MIGRATION_URL ?? '').trim();
  if (!url) throw new Error('DATABASE_MIGRATION_URL is required.');
  return { email, name, password, url };
}

/** Promotes the account if it exists, creates it otherwise. Returns what happened. */
export async function ensurePlatformAdmin(client, { email, name, password }) {
  const { rows } = await client.query(
    'SELECT id FROM users WHERE lower(email) = $1',
    [email],
  );
  if (rows[0]) {
    await client.query(
      'UPDATE users SET is_platform_admin = true WHERE id = $1',
      [rows[0].id],
    );
    return 'promoted';
  }
  const passwordHash = await hash(password, ARGON2);
  await client.query(
    `INSERT INTO users (email, password_hash, full_name, is_platform_admin, confirmed_at)
     VALUES ($1, $2, $3, true, now())`,
    [email, passwordHash, name],
  );
  return 'created';
}

async function main() {
  let input;
  try {
    input = validate(parseArgs(process.argv.slice(2)), process.env);
  } catch (error) {
    fail(error.message);
  }
  const client = new pg.Client({ connectionString: input.url });
  try {
    await client.connect();
    const result = await ensurePlatformAdmin(client, input);
    console.log(
      `create-platform-admin: ${input.email} ${result} as platform administrator.`,
    );
  } catch (error) {
    // Driver errors can quote connection details: report only their code/class.
    fail(`failed (${error?.code ?? error?.name ?? 'unknown error'}).`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}

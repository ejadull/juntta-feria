import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { loadEnv } from 'vite';
import { ownerTestUrl, ownerUrlFor, testDatabase } from './int.env.js';

/**
 * Integration suites share one throwaway `<db>_test` database: recreated once per run and
 * prepared with the real `db:setup` command (role + migrations), never touching development data.
 */
export default async function setup(): Promise<void> {
  Object.assign(process.env, { ...loadEnv('', '../../', ''), ...process.env });
  const admin = new pg.Client({ connectionString: ownerUrlFor('postgres') });
  await admin.connect();
  try {
    const db = admin.escapeIdentifier(testDatabase());
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${db}`);
  } finally {
    await admin.end();
  }
  execFileSync(process.execPath, ['scripts/db-setup.mjs'], {
    env: { ...process.env, DATABASE_MIGRATION_URL: ownerTestUrl() },
    stdio: 'pipe',
  });
}

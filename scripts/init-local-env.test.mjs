// Tests for scripts/init-local-env.mjs. Run: node --test scripts/init-local-env.test.mjs
// Uses temporary directories and fictitious values only.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { initLocalEnv, MARKER } from './init-local-env.mjs';

const TEMPLATE = [
  '# Local template (fictitious)',
  'NODE_ENV=development',
  'POSTGRES_DB=app_local',
  'POSTGRES_USER=app_local',
  `POSTGRES_PASSWORD=${MARKER}`,
  'POSTGRES_PORT=5432',
  `APP_DB_PASSWORD=${MARKER}`,
  'DATABASE_URL=postgresql://placeholder',
  'DATABASE_MIGRATION_URL=postgresql://placeholder',
  'S3_ACCESS_KEY=test',
  'S3_SECRET_KEY=test',
  `AUTH_ACCESS_TOKEN_SECRET=${MARKER}`,
  `AUTH_REFRESH_TOKEN_SECRET=${MARKER}`,
  'MP_ACCESS_TOKEN=TEST-SIMULATED-NOT-A-TOKEN',
  'MP_WEBHOOK_SECRET=SIMULATED-NOT-A-SECRET',
  '',
].join('\n');

function workspace(existingEnv) {
  const dir = mkdtempSync(path.join(tmpdir(), 'init-env-'));
  const examplePath = path.join(dir, '.env.example');
  const envPath = path.join(dir, '.env');
  writeFileSync(examplePath, TEMPLATE);
  if (existingEnv !== undefined) writeFileSync(envPath, existingEnv);
  return { examplePath, envPath };
}

const parse = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );

test('creates .env with distinct 64-char hex secrets in place of every marker', () => {
  const ws = workspace();
  const { changed } = initLocalEnv(ws);
  const env = parse(readFileSync(ws.envPath, 'utf8'));
  const secrets = [
    env.POSTGRES_PASSWORD,
    env.APP_DB_PASSWORD,
    env.AUTH_ACCESS_TOKEN_SECRET,
    env.AUTH_REFRESH_TOKEN_SECRET,
  ];
  for (const s of secrets) assert.match(s, /^[0-9a-f]{64}$/);
  assert.equal(new Set(secrets).size, 4);
  assert.ok(!readFileSync(ws.envPath, 'utf8').includes(MARKER));
  assert.ok(changed.includes('POSTGRES_PASSWORD'));
});

test('builds localhost URLs: the app connects as juntta_app, migrations as the owner (CORE-01)', () => {
  const ws = workspace();
  initLocalEnv(ws);
  const env = parse(readFileSync(ws.envPath, 'utf8'));
  assert.equal(
    env.DATABASE_URL,
    `postgresql://juntta_app:${env.APP_DB_PASSWORD}@localhost:5432/app_local`,
  );
  assert.equal(
    env.DATABASE_MIGRATION_URL,
    `postgresql://app_local:${env.POSTGRES_PASSWORD}@localhost:5432/app_local`,
  );
});

test('keeps the previous owner DATABASE_URL while the template has no APP_DB_PASSWORD', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'init-env-'));
  const examplePath = path.join(dir, '.env.example');
  const envPath = path.join(dir, '.env');
  writeFileSync(
    examplePath,
    TEMPLATE.split('\n')
      .filter((l) => !l.startsWith('APP_DB_PASSWORD=') && !l.startsWith('DATABASE_MIGRATION_URL='))
      .join('\n'),
  );
  initLocalEnv({ examplePath, envPath });
  const env = parse(readFileSync(envPath, 'utf8'));
  assert.equal(
    env.DATABASE_URL,
    `postgresql://app_local:${env.POSTGRES_PASSWORD}@localhost:5432/app_local`,
  );
  assert.equal(env.DATABASE_MIGRATION_URL, undefined);
});

test('preserves existing non-placeholder values and adds missing keys', () => {
  const ws = workspace('POSTGRES_PASSWORD=keepme0123\nPOSTGRES_PORT=5433\nCUSTOM=1\n');
  const { changed } = initLocalEnv(ws);
  const env = parse(readFileSync(ws.envPath, 'utf8'));
  assert.equal(env.POSTGRES_PASSWORD, 'keepme0123');
  assert.equal(env.POSTGRES_PORT, '5433');
  assert.equal(env.CUSTOM, '1');
  assert.equal(
    env.DATABASE_MIGRATION_URL,
    'postgresql://app_local:keepme0123@localhost:5433/app_local',
  );
  assert.match(env.DATABASE_URL, /^postgresql:\/\/juntta_app:[0-9a-f]{64}@localhost:5433\/app_local$/);
  assert.ok(!changed.includes('POSTGRES_PASSWORD'));
  assert.ok(changed.includes('NODE_ENV'));
});

test('keeps S3 credentials consistent and never writes Mercado Pago credentials', () => {
  const ws = workspace();
  initLocalEnv(ws);
  const env = parse(readFileSync(ws.envPath, 'utf8'));
  assert.equal(env.S3_ACCESS_KEY, 'test');
  assert.equal(env.S3_SECRET_KEY, 'test');
  assert.equal(env.MP_ACCESS_TOKEN, '');
  assert.equal(env.MP_WEBHOOK_SECRET, '');
});

test('is idempotent and returns key names only, never values', () => {
  const ws = workspace();
  initLocalEnv(ws);
  const before = readFileSync(ws.envPath, 'utf8');
  const second = initLocalEnv(ws);
  assert.equal(readFileSync(ws.envPath, 'utf8'), before);
  assert.deepEqual(second.changed, []);
  for (const key of initLocalEnv(workspace()).changed) assert.match(key, /^[A-Z0-9_]+$/);
});

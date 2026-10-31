#!/usr/bin/env node
// Creates or completes the ignored local .env from .env.example (ADR 0004, FND-02).
// - Replaces every GENERATE_LOCAL_HEX_64 marker with a unique 64-char hex secret (node:crypto).
// - Preserves existing non-placeholder values and keys already in .env.
// - Rebuilds DATABASE_URL (app role) and DATABASE_MIGRATION_URL (owner) for localhost.
// - Never writes Mercado Pago credentials (left empty until PAY-01).
// - Writes atomically and reports key NAMES only, never values.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = 'GENERATE_LOCAL_HEX_64';
/** Application role created by `npm run db:setup` (CORE-01). */
export const APP_DB_USER = 'juntta_app';
const NEVER_WRITE = new Set(['MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET']);

const isEntry = (line) => /^[A-Z0-9_]+=/.test(line);
const keyOf = (line) => line.slice(0, line.indexOf('='));
const valueOf = (line) => line.slice(line.indexOf('=') + 1);

function readEntries(file) {
  if (!existsSync(file)) return new Map();
  return new Map(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(isEntry)
      .map((l) => [keyOf(l), valueOf(l)]),
  );
}

/**
 * @param {{ examplePath: string, envPath: string, randomHex?: () => string }} options
 * @returns {{ changed: string[] }} names of keys added or rewritten
 */
export function initLocalEnv({ examplePath, envPath, randomHex = () => randomBytes(32).toString('hex') }) {
  const template = readFileSync(examplePath, 'utf8').split(/\r?\n/);
  const existing = readEntries(envPath);
  const values = new Map();

  for (const line of template.filter(isEntry)) {
    const key = keyOf(line);
    const current = existing.get(key);
    let value;
    // Mercado Pago: keep only credentials the developer set on purpose; never copy the template.
    if (NEVER_WRITE.has(key)) value = current && current !== valueOf(line) ? current : '';
    else if (current !== undefined && current !== '' && current !== MARKER) value = current;
    else value = valueOf(line) === MARKER ? randomHex() : valueOf(line);
    values.set(key, value);
  }

  const pg = (k) => values.get(k) ?? existing.get(k);
  if (values.has('DATABASE_URL') && pg('POSTGRES_USER') && pg('POSTGRES_PASSWORD') && pg('POSTGRES_DB')) {
    const url = (user, password) =>
      `postgresql://${user}:${password}@localhost:${pg('POSTGRES_PORT') ?? '5432'}/${pg('POSTGRES_DB')}`;
    const owner = url(pg('POSTGRES_USER'), pg('POSTGRES_PASSWORD'));
    // CORE-01: the API connects as juntta_app (no BYPASSRLS); only migrations use the owner role.
    // ponytail: old templates without APP_DB_PASSWORD keep the owner URL until they are updated.
    if (pg('APP_DB_PASSWORD')) {
      values.set('DATABASE_URL', url(APP_DB_USER, pg('APP_DB_PASSWORD')));
      if (values.has('DATABASE_MIGRATION_URL')) values.set('DATABASE_MIGRATION_URL', owner);
    } else {
      values.set('DATABASE_URL', owner);
    }
  }

  // Template layout and comments first, then keys that only exist in the local .env.
  const lines = template.map((line) => (isEntry(line) ? `${keyOf(line)}=${values.get(keyOf(line))}` : line));
  const extra = [...existing].filter(([k]) => !values.has(k)).map(([k, v]) => `${k}=${v}`);
  const output = [...lines.join('\n').trimEnd().split('\n'), ...extra, ''].join('\n');

  const changed = [...values].filter(([k, v]) => existing.get(k) !== v).map(([k]) => k);
  if (changed.length > 0) {
    const tmp = `${envPath}.tmp-${process.pid}`;
    writeFileSync(tmp, output, { mode: 0o600 });
    renameSync(tmp, envPath);
  }
  return { changed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { changed } = initLocalEnv({
    examplePath: path.join(root, '.env.example'),
    envPath: path.join(root, '.env'),
  });
  console.log(changed.length ? `.env actualizado: ${changed.join(', ')}` : '.env ya estaba completo; sin cambios.');
}

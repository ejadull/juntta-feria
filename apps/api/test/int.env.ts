/** Connection URLs for the integration database, derived from the owner URL (CORE-01). */

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests (see README).`);
  return value;
}

const ownerUrl = (): URL => new URL(required('DATABASE_MIGRATION_URL'));

export const testDatabase = (): string => `${ownerUrl().pathname.slice(1)}_test`;

export function ownerUrlFor(database: string): string {
  const url = ownerUrl();
  url.pathname = `/${database}`;
  return url.toString();
}

export const ownerTestUrl = (): string => ownerUrlFor(testDatabase());

export function appTestUrl(): string {
  const url = new URL(ownerTestUrl());
  url.username = 'juntta_app';
  url.password = required('APP_DB_PASSWORD');
  return url.toString();
}

/** The owner password, only to assert it never appears in outputs. */
export const ownerPassword = (): string => decodeURIComponent(ownerUrl().password);

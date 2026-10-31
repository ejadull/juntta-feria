import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Integration tests against the local PostgreSQL (CORE-01). Reads the repository .env for
// DATABASE_MIGRATION_URL and APP_DB_PASSWORD; the tests use a throwaway `<db>_test` database.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.int-spec.ts'],
    env: loadEnv('', '../../', ''),
    fileParallelism: false,
  },
});

import { defineConfig } from 'drizzle-kit';

// `generate` only reads the schema; applying migrations goes through `npm run db:setup`,
// which also creates the application role (CORE-01).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});

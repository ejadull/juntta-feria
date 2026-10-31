import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Relational schema (ADR 0005). Spatial columns, RLS policies, partial and expression indexes
 * live in hand-written SQL migrations; this file only declares what Drizzle types well.
 */

/** Anchor for tenant isolation (§2.2). RLS on tenant tables arrives with CORE-03. */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check('tenants_status_check', sql`${t.status} IN ('ACTIVE', 'SUSPENDED')`),
    check('tenants_slug_check', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('tenants_name_check', sql`btrim(${t.name}) <> ''`),
  ],
);

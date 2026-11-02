import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Relational schema (ADR 0005). Spatial columns, RLS policies, partial and expression indexes
 * live in hand-written SQL migrations; this file only declares what Drizzle types well.
 */

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Anchor for tenant isolation (§2.2). RLS on tenant tables arrives with CORE-03. */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: createdAt(),
  },
  (t) => [
    check('tenants_status_check', sql`${t.status} IN ('ACTIVE', 'SUSPENDED')`),
    check('tenants_slug_check', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('tenants_name_check', sql`btrim(${t.name}) <> ''`),
  ],
);

export const MEMBERSHIP_ROLES = ['OWNER', 'ADMIN', 'OPERATOR', 'EXHIBITOR'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/** Global accounts (CORE-02). Only the Argon2id hash is stored, never the password. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: createdAt(),
  },
  (t) => [
    // "Ana@x.com" and "ana@x.com" are the same account.
    uniqueIndex('users_email_lower_unique').on(sql`lower(${t.email})`),
    check('users_status_check', sql`${t.status} IN ('ACTIVE', 'DISABLED')`),
    check('users_email_check', sql`${t.email} ~ '^[^@\\s]+@[^@\\s]+$'`),
  ],
);

/** A user's role inside one tenant (§1.3). */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<MembershipRole>().notNull(),
    status: text('status').notNull().default('ACTIVE'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('memberships_tenant_user_unique').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
    check(
      'memberships_role_check',
      sql`${t.role} IN ('OWNER', 'ADMIN', 'OPERATOR', 'EXHIBITOR')`,
    ),
    check('memberships_status_check', sql`${t.status} IN ('ACTIVE', 'DISABLED')`),
  ],
);

/**
 * Opaque rotating refresh tokens (ADR 0004). Only an HMAC of the token is stored. Every login
 * starts a family; a token used twice revokes its whole family (reuse detection).
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('refresh_tokens_family_idx').on(t.familyId),
    index('refresh_tokens_user_idx').on(t.userId),
  ],
);

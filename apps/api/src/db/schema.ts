import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
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

/**
 * Owner tenant of a row in a tenant table (CORE-03): defaults to the tenant of the current
 * `withTenant` transaction, so inserts never take it from client input. RLS checks it again.
 */
const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .default(sql`nullif(current_setting('app.tenant_id', true), '')::uuid`)
    .references(() => tenants.id);

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

export const MEMBERSHIP_ROLES = [
  'OWNER',
  'ADMIN',
  'OPERATOR',
  'EXHIBITOR',
] as const;
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
    check(
      'memberships_status_check',
      sql`${t.status} IN ('ACTIVE', 'DISABLED')`,
    ),
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

/**
 * Append-only audit trail per tenant (CORE-03, §3.1). `tenant_id` defaults to the tenant of the
 * current transaction (`withTenant`); RLS and the missing UPDATE/DELETE grants live in SQL.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    beforeJson: jsonb('before_json'),
    afterJson: jsonb('after_json'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt),
    check('audit_logs_action_check', sql`btrim(${t.action}) <> ''`),
  ],
);

export const VENUE_TYPES = ['FIXED', 'TEMPORARY'] as const;
export type VenueType = (typeof VENUE_TYPES)[number];

/** Meters with centimeter precision, read back as numbers (§2: geometry is stored in meters). */
const meters = (name: string) =>
  numeric(name, { precision: 10, scale: 2, mode: 'number' }).notNull();

/** Fixed or temporary venue of a tenant (VEN-01, §3.1). RLS lives in the migration. */
export const venues = pgTable(
  'venues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    type: text('type').$type<VenueType>().notNull(),
    name: text('name').notNull(),
    address: text('address'),
    timezone: text('timezone').notNull(),
    widthM: meters('width_m'),
    heightM: meters('height_m'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Target of composite FKs (tenant_id, venue_id) from layouts and events (INV-02).
    unique('venues_tenant_id_unique').on(t.tenantId, t.id),
    // "Predio Norte" and " predio norte" are the same venue.
    uniqueIndex('venues_tenant_name_unique').on(t.tenantId, sql`lower(btrim(${t.name}))`),
    check('venues_type_check', sql`${t.type} IN ('FIXED', 'TEMPORARY')`),
    check('venues_name_check', sql`btrim(${t.name}) <> ''`),
    check('venues_size_check', sql`${t.widthM} > 0 AND ${t.heightM} > 0`),
  ],
);

/** Reusable floor plan of a tenant, optionally tied to a venue (LAY-01, §3.1). */
export const layoutTemplates = pgTable(
  'layout_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    venueId: uuid('venue_id'),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('layout_templates_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('layout_templates_tenant_name_unique').on(
      t.tenantId,
      sql`lower(btrim(${t.name}))`,
    ),
    // Same-tenant venue only (INV-02); a venue in use cannot be deleted.
    foreignKey({
      name: 'layout_templates_venue_fk',
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venues.tenantId, venues.id],
    }).onDelete('restrict'),
    check('layout_templates_name_check', sql`btrim(${t.name}) <> ''`),
  ],
);

export const LAYOUT_VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type LayoutVersionStatus = (typeof LAYOUT_VERSION_STATUSES)[number];

/**
 * Numbered version of a template (LAY-01). DRAFT → PUBLISHED → ARCHIVED; only drafts change
 * (INV-06), enforced by triggers in the migration. At most one draft and one published per template.
 */
export const layoutVersions = pgTable(
  'layout_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    templateId: uuid('template_id').notNull(),
    version: integer('version').notNull(),
    widthM: meters('width_m'),
    heightM: meters('height_m'),
    status: text('status').$type<LayoutVersionStatus>().notNull().default('DRAFT'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('layout_versions_tenant_id_unique').on(t.tenantId, t.id),
    unique('layout_versions_template_version_unique').on(t.templateId, t.version),
    uniqueIndex('layout_versions_one_draft').on(t.templateId).where(sql`${t.status} = 'DRAFT'`),
    uniqueIndex('layout_versions_one_published')
      .on(t.templateId)
      .where(sql`${t.status} = 'PUBLISHED'`),
    foreignKey({
      name: 'layout_versions_template_fk',
      columns: [t.tenantId, t.templateId],
      foreignColumns: [layoutTemplates.tenantId, layoutTemplates.id],
    }).onDelete('cascade'),
    check('layout_versions_status_check', sql`${t.status} IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')`),
    check(
      'layout_versions_published_at_check',
      sql`(${t.status} = 'DRAFT') = (${t.publishedAt} IS NULL)`,
    ),
    check('layout_versions_version_check', sql`${t.version} > 0`),
    check('layout_versions_size_check', sql`${t.widthM} > 0 AND ${t.heightM} > 0`),
  ],
);

export const LAYOUT_OBJECT_KINDS = [
  'STAND',
  'AISLE',
  'ENTRY',
  'EXIT',
  'UTILITY',
  'OBSTACLE',
  'EMERGENCY',
] as const;
export type LayoutObjectKind = (typeof LAYOUT_OBJECT_KINDS)[number];

/** Planar polygon in local meters (§2: SRID 0). Read/written as GeoJSON with ST_* functions. */
const polygon = customType<{ data: string }>({
  dataType: () => 'geometry(Polygon,0)',
});

/**
 * Object of a layout version (LAY-01). The id comes from the editor and is kept when a version is
 * cloned, so a stand keeps its identity across versions (INV-06 migrations of reservations).
 */
export const layoutObjects = pgTable(
  'layout_objects',
  {
    id: uuid('id').notNull(),
    tenantId: tenantId(),
    layoutVersionId: uuid('layout_version_id').notNull(),
    kind: text('kind').$type<LayoutObjectKind>().notNull(),
    code: text('code'),
    geometry: polygon('geometry').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    primaryKey({ name: 'layout_objects_pk', columns: [t.layoutVersionId, t.id] }),
    // Target of event_stands (tenant, version, object) composite FK (INV-03).
    unique('layout_objects_tenant_version_id_unique').on(t.tenantId, t.layoutVersionId, t.id),
    foreignKey({
      name: 'layout_objects_version_fk',
      columns: [t.tenantId, t.layoutVersionId],
      foreignColumns: [layoutVersions.tenantId, layoutVersions.id],
    }).onDelete('cascade'),
    check(
      'layout_objects_kind_check',
      sql`${t.kind} IN ('STAND', 'AISLE', 'ENTRY', 'EXIT', 'UTILITY', 'OBSTACLE', 'EMERGENCY')`,
    ),
    check('layout_objects_metadata_check', sql`jsonb_typeof(${t.metadata}) = 'object'`),
  ],
);

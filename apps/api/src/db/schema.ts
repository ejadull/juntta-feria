import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
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
    /** Null for accounts created with Google (CORE-05): they have no password and cannot use password login. */
    passwordHash: text('password_hash'),
    /** Google account id (`sub` of the ID token), bound on the first Google sign-in (CORE-05). */
    googleSub: text('google_sub').unique(),
    status: text('status').notNull().default('ACTIVE'),
    fullName: text('full_name'),
    /** SaaS superadministrator (§1.3): operates tenants; not a tenant role. */
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    /** E.164 digits without "+", e.g. 5491123456789 (EXH-04). */
    phone: text('phone'),
    /** Set when the account was confirmed (accepting an invitation, EXH-04); RES-01 requires it. */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // "Ana@x.com" and "ana@x.com" are the same account.
    uniqueIndex('users_email_lower_unique').on(sql`lower(${t.email})`),
    check('users_status_check', sql`${t.status} IN ('ACTIVE', 'DISABLED')`),
    check('users_email_check', sql`${t.email} ~ '^[^@\\s]+@[^@\\s]+$'`),
    // An account without a password must be reachable through Google, or nobody can sign in.
    check(
      'users_credential_check',
      sql`${t.passwordHash} IS NOT NULL OR ${t.googleSub} IS NOT NULL`,
    ),
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
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Target of composite FKs (tenant_id, venue_id) from layouts and events (INV-02).
    unique('venues_tenant_id_unique').on(t.tenantId, t.id),
    // "Predio Norte" and " predio norte" are the same venue.
    uniqueIndex('venues_tenant_name_unique').on(
      t.tenantId,
      sql`lower(btrim(${t.name}))`,
    ),
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

export const LAYOUT_VERSION_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'ARCHIVED',
] as const;
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
    status: text('status')
      .$type<LayoutVersionStatus>()
      .notNull()
      .default('DRAFT'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('layout_versions_tenant_id_unique').on(t.tenantId, t.id),
    unique('layout_versions_template_version_unique').on(
      t.templateId,
      t.version,
    ),
    uniqueIndex('layout_versions_one_draft')
      .on(t.templateId)
      .where(sql`${t.status} = 'DRAFT'`),
    uniqueIndex('layout_versions_one_published')
      .on(t.templateId)
      .where(sql`${t.status} = 'PUBLISHED'`),
    foreignKey({
      name: 'layout_versions_template_fk',
      columns: [t.tenantId, t.templateId],
      foreignColumns: [layoutTemplates.tenantId, layoutTemplates.id],
    }).onDelete('cascade'),
    check(
      'layout_versions_status_check',
      sql`${t.status} IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')`,
    ),
    check(
      'layout_versions_published_at_check',
      sql`(${t.status} = 'DRAFT') = (${t.publishedAt} IS NULL)`,
    ),
    check('layout_versions_version_check', sql`${t.version} > 0`),
    check(
      'layout_versions_size_check',
      sql`${t.widthM} > 0 AND ${t.heightM} > 0`,
    ),
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
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    primaryKey({
      name: 'layout_objects_pk',
      columns: [t.layoutVersionId, t.id],
    }),
    // Target of event_stands (tenant, version, object) composite FK (INV-03).
    unique('layout_objects_tenant_version_id_unique').on(
      t.tenantId,
      t.layoutVersionId,
      t.id,
    ),
    foreignKey({
      name: 'layout_objects_version_fk',
      columns: [t.tenantId, t.layoutVersionId],
      foreignColumns: [layoutVersions.tenantId, layoutVersions.id],
    }).onDelete('cascade'),
    check(
      'layout_objects_kind_check',
      sql`${t.kind} IN ('STAND', 'AISLE', 'ENTRY', 'EXIT', 'UTILITY', 'OBSTACLE', 'EMERGENCY')`,
    ),
    check(
      'layout_objects_metadata_check',
      sql`jsonb_typeof(${t.metadata}) = 'object'`,
    ),
  ],
);

export const EVENT_STATUSES = [
  'DRAFT',
  'PUBLISHED',
  'ACTIVE',
  'CLOSED',
  'CANCELLED',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

const instant = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull();

/**
 * Event on a published, immutable layout version (EVT-01, INV-03). The slug is global because
 * the public portal addresses events by slug alone (§5 `/public/events/:slug`).
 */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    venueId: uuid('venue_id').notNull(),
    layoutVersionId: uuid('layout_version_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    startsAt: instant('starts_at'),
    endsAt: instant('ends_at'),
    salesOpenAt: instant('sales_open_at'),
    salesCloseAt: instant('sales_close_at'),
    status: text('status').$type<EventStatus>().notNull().default('DRAFT'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('events_tenant_id_unique').on(t.tenantId, t.id),
    // Target of event_stands (tenant, event, layout version): a stand comes from the event's layout.
    unique('events_tenant_id_layout_unique').on(
      t.tenantId,
      t.id,
      t.layoutVersionId,
    ),
    foreignKey({
      name: 'events_venue_fk',
      columns: [t.tenantId, t.venueId],
      foreignColumns: [venues.tenantId, venues.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'events_layout_version_fk',
      columns: [t.tenantId, t.layoutVersionId],
      foreignColumns: [layoutVersions.tenantId, layoutVersions.id],
    }).onDelete('restrict'),
    check(
      'events_status_check',
      sql`${t.status} IN ('DRAFT', 'PUBLISHED', 'ACTIVE', 'CLOSED', 'CANCELLED')`,
    ),
    check('events_name_check', sql`btrim(${t.name}) <> ''`),
    check('events_slug_check', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      'events_dates_check',
      sql`${t.startsAt} < ${t.endsAt} AND ${t.salesOpenAt} < ${t.salesCloseAt} AND ${t.salesCloseAt} <= ${t.endsAt}`,
    ),
    check(
      'events_published_at_check',
      sql`${t.status} = 'DRAFT' OR ${t.status} = 'CANCELLED' OR ${t.publishedAt} IS NOT NULL`,
    ),
  ],
);

/** Thematic grouping of an event's stands (ADR 0002). */
export const eventSectors = pgTable(
  'event_sectors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    // Target of the INV-09 composite FK from event_stands.
    unique('event_sectors_tenant_event_id_unique').on(
      t.tenantId,
      t.eventId,
      t.id,
    ),
    // "Diseño" and "diseño " are the same sector.
    uniqueIndex('event_sectors_name_unique').on(
      t.tenantId,
      t.eventId,
      sql`lower(btrim(${t.name}))`,
    ),
    foreignKey({
      name: 'event_sectors_event_fk',
      columns: [t.tenantId, t.eventId],
      foreignColumns: [events.tenantId, events.id],
    }).onDelete('cascade'),
    check('event_sectors_name_check', sql`btrim(${t.name}) <> ''`),
  ],
);

export const EVENT_STAND_STATUSES = [
  'AVAILABLE',
  'BLOCKED',
  'ASSIGNED',
  'DISABLED',
] as const;
export type EventStandStatus = (typeof EVENT_STAND_STATUSES)[number];

/**
 * Sellable inventory of an event: one row per STAND object of its layout (INV-03). A NULL price
 * means "no tariff yet" (§4.1: an event cannot be published with sellable stands without one).
 */
export const eventStands = pgTable(
  'event_stands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    eventId: uuid('event_id').notNull(),
    layoutVersionId: uuid('layout_version_id').notNull(),
    layoutObjectId: uuid('layout_object_id').notNull(),
    sectorId: uuid('sector_id'),
    code: text('code').notNull(),
    status: text('status')
      .$type<EventStandStatus>()
      .notNull()
      .default('AVAILABLE'),
    priceCents: bigint('price_cents', { mode: 'number' }),
    currency: char('currency', { length: 3 }).notNull().default('ARS'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('event_stands_tenant_id_unique').on(t.tenantId, t.id),
    unique('event_stands_event_code_unique').on(t.tenantId, t.eventId, t.code),
    unique('event_stands_event_object_unique').on(t.eventId, t.layoutObjectId),
    foreignKey({
      name: 'event_stands_event_fk',
      columns: [t.tenantId, t.eventId, t.layoutVersionId],
      foreignColumns: [events.tenantId, events.id, events.layoutVersionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'event_stands_layout_object_fk',
      columns: [t.tenantId, t.layoutVersionId, t.layoutObjectId],
      foreignColumns: [
        layoutObjects.tenantId,
        layoutObjects.layoutVersionId,
        layoutObjects.id,
      ],
    }).onDelete('restrict'),
    // INV-09. The migration turns ON DELETE into SET NULL (sector_id) (PostgreSQL >= 15).
    foreignKey({
      name: 'event_stands_sector_fk',
      columns: [t.tenantId, t.eventId, t.sectorId],
      foreignColumns: [
        eventSectors.tenantId,
        eventSectors.eventId,
        eventSectors.id,
      ],
    }),
    index('event_stands_event_idx').on(t.eventId),
    check(
      'event_stands_status_check',
      sql`${t.status} IN ('AVAILABLE', 'BLOCKED', 'ASSIGNED', 'DISABLED')`,
    ),
    check(
      'event_stands_price_check',
      sql`${t.priceCents} IS NULL OR ${t.priceCents} >= 0`,
    ),
    check('event_stands_currency_check', sql`${t.currency} = 'ARS'`),
  ],
);

/**
 * Commercial profile of an exhibitor member in one organization (EXH-01, §3.1). The member owns
 * it and its public consent (Ley 25.326); `public_consent_at` records when consent was given.
 * Private data (legal name, CUIT) never leaves organizer views (INV-08).
 */
export const exhibitors = pgTable(
  'exhibitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name').notNull(),
    taxId: text('tax_id'),
    category: text('category').notNull(),
    description: text('description').notNull().default(''),
    logoKey: text('logo_key'),
    publicContactOptIn: boolean('public_contact_opt_in')
      .notNull()
      .default(false),
    publicConsentAt: timestamp('public_consent_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Target of the reservations (tenant, exhibitor) composite FK (INV-02).
    unique('exhibitors_tenant_id_unique').on(t.tenantId, t.id),
    unique('exhibitors_tenant_user_unique').on(t.tenantId, t.userId),
    check(
      'exhibitors_names_check',
      sql`btrim(${t.legalName}) <> '' AND btrim(${t.tradeName}) <> ''`,
    ),
    check('exhibitors_category_check', sql`btrim(${t.category}) <> ''`),
    check(
      'exhibitors_tax_id_check',
      sql`${t.taxId} IS NULL OR ${t.taxId} ~ '^[0-9]{11}$'`,
    ),
    check(
      'exhibitors_consent_check',
      sql`${t.publicContactOptIn} = (${t.publicConsentAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * One-time invitation of an organization to a future exhibitor (EXH-04). Only a SHA-256 of the
 * token is stored; the link is shown once, when created. Public lookup goes through the
 * `exhibitor_invitation_lookup` SECURITY DEFINER function (the link carries no tenant).
 */
export const exhibitorInvitations = pgTable(
  'exhibitor_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    tokenHash: text('token_hash').notNull().unique(),
    email: text('email'),
    phone: text('phone'),
    name: text('name'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: instant('expires_at'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedUserId: uuid('accepted_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('exhibitor_invitations_tenant_created_idx').on(
      t.tenantId,
      t.createdAt,
    ),
    check(
      'exhibitor_invitations_final_state_check',
      sql`${t.acceptedAt} IS NULL OR ${t.revokedAt} IS NULL`,
    ),
  ],
);

export const SUBSCRIPTION_STATUSES = [
  'PENDING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELLED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Platform subscription of an exhibitor (EXH-05, decision 2026-11-06): paid to Juntta through a
 * Mercado Pago preapproval, valid in every organization, so it is global per user like `users`
 * (no tenant, no RLS). `user_id` doubles as the preapproval's `external_reference`. PENDING
 * (preapproval created, not authorized yet) never enables reserving; the webhook moves it on.
 */
export const platformSubscriptions = pgTable(
  'platform_subscriptions',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').$type<SubscriptionStatus>().notNull(),
    /** Null until the first authorization; the paid period ends here. */
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    providerSubscriptionId: text('provider_subscription_id'),
    /** Where the payer authorizes the preapproval; only meaningful while PENDING. */
    initPoint: text('init_point'),
    /** Mercado Pago requires the paying account to have this email. */
    payerEmail: text('payer_email'),
    /** Last status read from the provider: pending | authorized | paused | cancelled. */
    providerStatus: text('provider_status'),
    /** Keys the provider create, so a retry returns the same preapproval. */
    idempotencyKey: uuid('idempotency_key'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'platform_subscriptions_status_check',
      sql`${t.status} IN ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELLED')`,
    ),
    uniqueIndex('platform_subscriptions_provider_unique').on(
      t.providerSubscriptionId,
    ),
  ],
);

export const RESERVATION_STATUSES = [
  'HELD',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'EXPIRED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Statuses that own the stand (INV-01): at most one per event stand. */
export const ACTIVE_RESERVATION_STATUSES = [
  'HELD',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'REFUND_PENDING',
] as const;

/**
 * Reservation of an event stand by an exhibitor (RES-01, §6). Price and terms are a snapshot
 * taken at hold time (INV-05); the stand and the exhibitor are of the same tenant (INV-02).
 */
export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    eventStandId: uuid('event_stand_id').notNull(),
    exhibitorId: uuid('exhibitor_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: text('status').$type<ReservationStatus>().notNull().default('HELD'),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    priceCents: bigint('price_cents', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    termsVersion: text('terms_version').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('reservations_tenant_id_unique').on(t.tenantId, t.id),
    unique('reservations_idempotency_unique').on(
      t.tenantId,
      t.userId,
      t.idempotencyKey,
    ),
    // INV-01: one active reservation per event stand, whatever the application does.
    uniqueIndex('reservations_one_active_per_stand')
      .on(t.eventStandId)
      .where(
        sql`${t.status} IN ('HELD', 'PAYMENT_PENDING', 'CONFIRMED', 'REFUND_PENDING')`,
      ),
    index('reservations_exhibitor_idx').on(t.exhibitorId),
    foreignKey({
      name: 'reservations_event_stand_fk',
      columns: [t.tenantId, t.eventStandId],
      foreignColumns: [eventStands.tenantId, eventStands.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'reservations_exhibitor_fk',
      columns: [t.tenantId, t.exhibitorId],
      foreignColumns: [exhibitors.tenantId, exhibitors.id],
    }).onDelete('restrict'),
    check(
      'reservations_status_check',
      sql`${t.status} IN ('HELD', 'PAYMENT_PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED')`,
    ),
    check(
      'reservations_hold_check',
      sql`${t.status} <> 'HELD' OR ${t.holdExpiresAt} IS NOT NULL`,
    ),
    check('reservations_price_check', sql`${t.priceCents} >= 0`),
    check('reservations_terms_check', sql`btrim(${t.termsVersion}) <> ''`),
  ],
);

export const PAYMENT_ATTEMPT_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

/**
 * One checkout of a reservation (PAY-02, ADR 0006 §4). Its id is the provider
 * `external_reference`; the amount is the reservation snapshot (INV-05). At most one PENDING
 * attempt per reservation, so retrying the checkout never opens a second order.
 */
export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    reservationId: uuid('reservation_id').notNull(),
    status: text('status')
      .$type<PaymentAttemptStatus>()
      .notNull()
      .default('PENDING'),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    /** Provider order id (Checkout Pro via Orders API); set once, null until the order exists. */
    providerCheckoutId: text('provider_checkout_id'),
    checkoutUrl: text('checkout_url'),
    /** Last payment the provider reported for this attempt (PAY-03); refunds need its id. */
    paymentId: text('payment_id'),
    paymentStatus: text('payment_status'),
    expiresAt: instant('expires_at'),
    idempotencyKey: uuid('idempotency_key').notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('payment_attempts_tenant_id_unique').on(t.tenantId, t.id),
    unique('payment_attempts_idempotency_unique').on(
      t.tenantId,
      t.reservationId,
      t.idempotencyKey,
    ),
    uniqueIndex('payment_attempts_provider_checkout_unique')
      .on(t.providerCheckoutId)
      .where(sql`${t.providerCheckoutId} IS NOT NULL`),
    uniqueIndex('payment_attempts_one_pending_per_reservation')
      .on(t.reservationId)
      .where(sql`${t.status} = 'PENDING'`),
    foreignKey({
      name: 'payment_attempts_reservation_fk',
      columns: [t.tenantId, t.reservationId],
      foreignColumns: [reservations.tenantId, reservations.id],
    }).onDelete('restrict'),
    check(
      'payment_attempts_status_check',
      sql`${t.status} IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')`,
    ),
    check('payment_attempts_amount_check', sql`${t.amountCents} >= 0`),
    check(
      'payment_attempts_checkout_check',
      sql`(${t.providerCheckoutId} IS NULL) = (${t.checkoutUrl} IS NULL)`,
    ),
  ],
);

/**
 * The organizer's Mercado Pago seller account, linked by OAuth (PAY-07, ADR 0006 §2). One per
 * tenant. Tokens are AES-256-GCM ciphertext (`TokenCipher`) named by `key_id`; never in clear.
 */
export const sellerAccounts = pgTable(
  'seller_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    /** Mercado Pago `user_id` of the seller: the expected collector of every payment. */
    sellerId: text('seller_id').notNull(),
    liveMode: boolean('live_mode').notNull(),
    accessTokenSealed: text('access_token_sealed').notNull(),
    refreshTokenSealed: text('refresh_token_sealed').notNull(),
    keyId: text('key_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    linkedBy: uuid('linked_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    linkedAt: timestamp('linked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
  },
  (t) => [unique('seller_accounts_tenant_unique').on(t.tenantId)],
);

export const PAYMENT_REFUND_KINDS = ['REFUND', 'CANCEL'] as const;
export type PaymentRefundKind = (typeof PAYMENT_REFUND_KINDS)[number];
export const PAYMENT_REFUND_STATUSES = ['PENDING', 'SUCCEEDED'] as const;
export type PaymentRefundStatus = (typeof PAYMENT_REFUND_STATUSES)[number];

/**
 * One reversal sent to the provider (PAY-06): a refund of an approved payment or the
 * cancellation of a pending one, one row per `payment_id`. The row id is the provider
 * idempotency key, so a retry of a PENDING row can never refund twice.
 */
export const paymentRefunds = pgTable(
  'payment_refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    reservationId: uuid('reservation_id').notNull(),
    attemptId: uuid('attempt_id').notNull(),
    paymentId: text('payment_id').notNull(),
    kind: text('kind').$type<PaymentRefundKind>().notNull(),
    /** Null refunds whatever is left of the payment. */
    amountCents: bigint('amount_cents', { mode: 'number' }),
    status: text('status')
      .$type<PaymentRefundStatus>()
      .notNull()
      .default('PENDING'),
    providerRefundId: text('provider_refund_id'),
    idempotencyKey: uuid('idempotency_key').notNull(),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('payment_refunds_idempotency_unique').on(
      t.tenantId,
      t.reservationId,
      t.idempotencyKey,
      t.paymentId,
    ),
    index('payment_refunds_reservation_idx').on(t.reservationId),
    foreignKey({
      name: 'payment_refunds_reservation_fk',
      columns: [t.tenantId, t.reservationId],
      foreignColumns: [reservations.tenantId, reservations.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payment_refunds_attempt_fk',
      columns: [t.tenantId, t.attemptId],
      foreignColumns: [paymentAttempts.tenantId, paymentAttempts.id],
    }).onDelete('restrict'),
    check('payment_refunds_kind_check', sql`${t.kind} IN ('REFUND', 'CANCEL')`),
    check(
      'payment_refunds_status_check',
      sql`${t.status} IN ('PENDING', 'SUCCEEDED')`,
    ),
    check(
      'payment_refunds_amount_check',
      sql`${t.amountCents} IS NULL OR (${t.kind} = 'REFUND' AND ${t.amountCents} > 0)`,
    ),
  ],
);

export const WEBHOOK_INBOX_STATUSES = [
  'RECEIVED',
  'PROCESSED',
  'IGNORED',
  'FAILED',
] as const;
export type WebhookInboxStatus = (typeof WEBHOOK_INBOX_STATUSES)[number];

/**
 * Mercado Pago notifications as received (PAY-03, §6.7), deduplicated by `x-request-id`.
 * Global like users: the tenant is only known once the payment is read. Nothing secret is kept,
 * only identifiers; the payment itself is always re-read server-to-server.
 */
export const paymentWebhookInbox = pgTable(
  'payment_webhook_inbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: text('request_id').notNull().unique(),
    topic: text('topic').notNull(),
    dataId: text('data_id').notNull(),
    /** Untrusted hint from the notification URL: no FK, checked against the payment. */
    tenantId: uuid('tenant_id'),
    status: text('status')
      .$type<WebhookInboxStatus>()
      .notNull()
      .default('RECEIVED'),
    /** Why it ended as it did (e.g. CONFIRMED, AMOUNT_MISMATCH, LATE_PAYMENT_CONFLICT). */
    outcome: text('outcome'),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'payment_webhook_inbox_status_check',
      sql`${t.status} IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')`,
    ),
  ],
);

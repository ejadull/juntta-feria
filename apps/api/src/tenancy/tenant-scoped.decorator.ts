import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import type { MembershipRole } from '../db/schema.js';
import { TENANT_ROLES, TenantGuard } from './tenant.guard.js';

export type { TenantRequest } from './tenant.guard.js';

type Roles = [MembershipRole, ...MembershipRole[]];

/** Who manages the organizer's back office (§5 "owner/operator"; ADMIN is the owner's delegate, §1.3). */
export const MANAGERS: Roles = ['OWNER', 'ADMIN', 'OPERATOR'];
/** Irreversible or publishing actions (§5 "owner"). */
export const OWNERS: Roles = ['OWNER', 'ADMIN'];

/**
 * Marks a handler (or controller) as tenant-scoped (CORE-03): Bearer token, `X-Tenant-Id` of an
 * active membership and one of `roles`. Handlers then run their queries with
 * `database.withTenant(request.tenant.id, ...)` so RLS applies.
 */
export const TenantScoped = (...roles: Roles) =>
  applyDecorators(
    SetMetadata(TENANT_ROLES, roles),
    UseGuards(AccessTokenGuard, TenantGuard),
  );

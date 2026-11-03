import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import type { MembershipRole } from '../db/schema.js';
import { TENANT_ROLES, TenantGuard } from './tenant.guard.js';

export type { TenantRequest } from './tenant.guard.js';

/**
 * Marks a handler (or controller) as tenant-scoped (CORE-03): Bearer token, `X-Tenant-Id` of an
 * active membership and one of `roles`. Handlers then run their queries with
 * `database.withTenant(request.tenant.id, ...)` so RLS applies.
 */
export const TenantScoped = (...roles: [MembershipRole, ...MembershipRole[]]) =>
  applyDecorators(
    SetMetadata(TENANT_ROLES, roles),
    UseGuards(AccessTokenGuard, TenantGuard),
  );

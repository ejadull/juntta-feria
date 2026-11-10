import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import type { AuthenticatedRequest } from '../auth/access-token.guard.js';
import { DatabaseService, isUuid } from '../db/database.service.js';
import { memberships, tenants, type MembershipRole } from '../db/schema.js';

export const TENANT_ROLES = 'tenant-roles';
export const TENANT_HEADER = 'x-tenant-id';

/** A request that passed TenantGuard: the user is an active member of `tenant.id`. */
export type TenantRequest = AuthenticatedRequest & {
  tenant: { id: string; role: MembershipRole };
};

/**
 * Resolves the tenant chosen by the client (`X-Tenant-Id`) and authorizes it against the user's
 * active membership (CORE-03). Foreign, unknown and suspended tenants get the same 404 (§9), so
 * the answer never reveals whether a tenant exists. Runs after AccessTokenGuard.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenantId = request.headers[TENANT_HEADER];
    if (!isUuid(tenantId))
      throw new BadRequestException('X-Tenant-Id must be a tenant UUID.');

    const [membership] = await this.database.db
      .select({ role: memberships.role })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(
        and(
          eq(memberships.userId, request.user.id),
          eq(memberships.tenantId, tenantId),
          eq(memberships.status, 'ACTIVE'),
          eq(tenants.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!membership) throw new NotFoundException('Resource not found.');

    const allowed = this.reflector.getAllAndOverride<
      readonly MembershipRole[] | undefined
    >(TENANT_ROLES, [context.getHandler(), context.getClass()]);
    if (allowed && !allowed.includes(membership.role))
      throw new ForbiddenException('Your role cannot perform this action.');

    (request as TenantRequest).tenant = { id: tenantId, role: membership.role };
    return true;
  }
}

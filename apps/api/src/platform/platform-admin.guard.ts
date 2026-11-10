import {
  applyDecorators,
  ForbiddenException,
  Injectable,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  AccessTokenGuard,
  type AuthenticatedRequest,
} from '../auth/access-token.guard.js';
import { DatabaseService } from '../db/database.service.js';
import { users } from '../db/schema.js';

/**
 * Authorizes the SaaS superadministrator (§1.3). Runs after AccessTokenGuard and re-reads the
 * flag on every request, so revoking it (or disabling the account) takes effect immediately
 * instead of when the access token expires. No tenant header: platform routes are not tenant-scoped.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [user] = await this.database.db
      .select({ isPlatformAdmin: users.isPlatformAdmin, status: users.status })
      .from(users)
      .where(eq(users.id, request.user.id));
    if (!user?.isPlatformAdmin || user.status !== 'ACTIVE')
      throw new ForbiddenException('Platform administrator role required.');
    return true;
  }
}

/** Bearer token of an active platform administrator; 401 anonymous, 403 anyone else. */
export const PlatformAdminOnly = () =>
  applyDecorators(UseGuards(AccessTokenGuard, PlatformAdminGuard));

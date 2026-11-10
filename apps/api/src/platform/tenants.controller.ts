import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/access-token.guard.js';
import { parseBody } from '../http/parse-body.js';
import { PlatformAdminOnly } from './platform-admin.guard.js';
import { createTenantInput } from './tenant.input.js';
import {
  TenantsService,
  type CreatedTenant,
  type TenantSummary,
} from './tenants.service.js';

/** CORE-04 (§5): organizations are created and listed by the platform administrator only. */
@Controller('tenants')
@PlatformAdminOnly()
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<CreatedTenant> {
    const input = parseBody(createTenantInput, body, 'organization');
    return this.tenants.create(request.user.id, input);
  }

  @Get()
  list(): Promise<TenantSummary[]> {
    return this.tenants.list();
  }
}

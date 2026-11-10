import { Module } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';

/** SaaS superadministration (CORE-04). AuthModule and AuditService come from the global TenancyModule. */
@Module({
  controllers: [TenantsController],
  providers: [TenantsService, PlatformAdminGuard],
})
export class PlatformModule {}

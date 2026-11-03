import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuditService } from './audit.service.js';
import { TenantGuard } from './tenant.guard.js';

/**
 * Global so every feature module can use `@TenantScoped(...)` and AuditService without importing
 * AuthModule itself (the decorator needs AccessTokenGuard and TenantGuard resolvable).
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [TenantGuard, AuditService],
  exports: [AuthModule, TenantGuard, AuditService],
})
export class TenancyModule {}

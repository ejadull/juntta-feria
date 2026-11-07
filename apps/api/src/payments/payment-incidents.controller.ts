import { Controller, Get, Req } from '@nestjs/common';
import { desc, inArray } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service.js';
import { auditLogs } from '../db/schema.js';
import { OWNERS, TenantScoped, type TenantRequest } from '../tenancy/tenant-scoped.decorator.js';

/** Audit actions that need a human: money that arrived but could not be applied (INV-07). */
const INCIDENTS: Readonly<Record<string, string>> = {
  'payment.late_conflict': 'LATE_PAYMENT_CONFLICT',
  'payment.mismatch': 'AMOUNT_MISMATCH',
};
const LIMIT = 200;

export interface PaymentIncident {
  readonly id: string;
  readonly code: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly detail: unknown;
  readonly createdAt: Date;
}

/**
 * Payment incidents of the organization for P10 (PAY-05), newest first. Read model over the audit
 * trail; resolving them (refund) is PAY-06.
 */
@Controller('payment-incidents')
export class PaymentIncidentsController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @TenantScoped(...OWNERS)
  async list(@Req() request: TenantRequest): Promise<PaymentIncident[]> {
    const rows = await this.database.withTenant(request.tenant.id, (tx) =>
      tx
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          detail: auditLogs.afterJson,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .where(inArray(auditLogs.action, Object.keys(INCIDENTS)))
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(LIMIT),
    );
    return rows.map(({ action, ...row }) => ({ ...row, code: INCIDENTS[action] }));
  }
}

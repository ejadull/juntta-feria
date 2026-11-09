import { Controller, Get, Req } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service.js';
import { auditLogs, paymentAttempts } from '../db/schema.js';
import {
  OWNERS,
  TenantScoped,
  type TenantRequest,
} from '../tenancy/tenant-scoped.decorator.js';

/** Audit actions that need a human: money that arrived but could not be applied (INV-07). */
const INCIDENTS: Readonly<Record<string, string>> = {
  'payment.late_conflict': 'LATE_PAYMENT_CONFLICT',
  'payment.mismatch': 'AMOUNT_MISMATCH',
  'payment.charged_back': 'CHARGEBACK',
};
const LIMIT = 200;

export interface PaymentIncident {
  readonly id: string;
  readonly code: string;
  readonly entityType: string;
  readonly entityId: string | null;
  /** The reservation to refund (POST /reservations/:id/refunds, PAY-06). */
  readonly reservationId: string | null;
  readonly detail: unknown;
  readonly createdAt: Date;
}

/**
 * Payment incidents of the organization for P10 (PAY-05), newest first. Read model over the audit
 * trail; they are resolved with a refund of the reservation (PAY-06).
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
          // Mismatches are recorded on the attempt; the others on the reservation.
          reservationId: sql<
            string | null
          >`coalesce(${paymentAttempts.reservationId}, ${auditLogs.entityId})`,
          detail: auditLogs.afterJson,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(
          paymentAttempts,
          and(
            eq(auditLogs.entityType, 'payment_attempt'),
            eq(paymentAttempts.id, auditLogs.entityId),
          ),
        )
        .where(inArray(auditLogs.action, Object.keys(INCIDENTS)))
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(LIMIT),
    );
    return rows.map(({ action, ...row }) => ({
      ...row,
      code: INCIDENTS[action],
    }));
  }
}

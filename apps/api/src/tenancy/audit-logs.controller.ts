import { Controller, Get, Query, Req } from '@nestjs/common';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { DatabaseService } from '../db/database.service.js';
import { auditLogs, users } from '../db/schema.js';
import { parseBody } from '../http/parse-body.js';
import {
  OWNERS,
  TenantScoped,
  type TenantRequest,
} from './tenant-scoped.decorator.js';

const auditQuery = z.strictObject({
  entityType: z
    .string()
    .regex(/^[a-z_]{1,40}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export interface AuditLogEntry {
  readonly id: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly actorId: string | null;
  readonly actorEmail: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly createdAt: Date;
}

/**
 * The organization's audit trail for its admins (CORE-03), newest first; e.g. the exhibitor
 * registration log is `?entityType=exhibitor_invitation` (EXH-04). RLS limits it to the tenant.
 */
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @TenantScoped(...OWNERS)
  list(
    @Req() request: TenantRequest,
    @Query() query: unknown,
  ): Promise<AuditLogEntry[]> {
    const { entityType, limit } = parseBody(auditQuery, query, 'audit query');
    const filters: SQL[] = entityType
      ? [eq(auditLogs.entityType, entityType)]
      : [];
    return this.database.withTenant(request.tenant.id, (tx) =>
      tx
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          actorId: auditLogs.actorId,
          actorEmail: users.email,
          before: auditLogs.beforeJson,
          after: auditLogs.afterJson,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(and(...filters))
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(limit),
    );
  }
}

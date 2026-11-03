import { Injectable } from '@nestjs/common';
import type { Transaction } from '../db/database.service.js';
import { auditLogs } from '../db/schema.js';

export interface AuditEntry {
  readonly actorId: string | null;
  /** Dotted verb, e.g. `venue.updated`, `reservation.confirmed`. */
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
}

/**
 * Appends to the tenant audit trail (CORE-03, §6 rule 9). Takes the caller's transaction, so the
 * entry commits or rolls back with the change it describes; the tenant comes from `withTenant`.
 */
@Injectable()
export class AuditService {
  async record(tx: Transaction, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values({
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeJson: entry.before ?? null,
      afterJson: entry.after ?? null,
    });
  }
}

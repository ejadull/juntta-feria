import { ConflictException, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  DatabaseService,
  isUniqueViolation,
  type Transaction,
} from '../db/database.service.js';
import { exhibitors } from '../db/schema.js';
import { AuditService } from '../tenancy/audit.service.js';
import type { ExhibitorProfileInput } from './exhibitor.input.js';

const view = {
  id: exhibitors.id,
  legalName: exhibitors.legalName,
  tradeName: exhibitors.tradeName,
  taxId: exhibitors.taxId,
  category: exhibitors.category,
  description: exhibitors.description,
  publicContactOptIn: exhibitors.publicContactOptIn,
  publicConsentAt: exhibitors.publicConsentAt,
  createdAt: exhibitors.createdAt,
  updatedAt: exhibitors.updatedAt,
};

/** Private profile: only its owner and the organizers of its organization see it (INV-08). */
export type ExhibitorProfile = Omit<typeof exhibitors.$inferSelect, 'tenantId' | 'userId' | 'logoKey'>;

/** `documents` arrives with EP05; until then nothing has been uploaded (D4 contract). */
export type DocumentsStatus = 'MISSING' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type ExhibitorSummary = ExhibitorProfile & { documentsStatus: DocumentsStatus };

const summary = (profile: ExhibitorProfile): ExhibitorSummary => ({
  ...profile,
  documentsStatus: 'MISSING',
});

/** EXH-01: the member edits its own profile and consent; organizers read them. */
@Injectable()
export class ExhibitorsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  getOwn(tenantId: string, userId: string): Promise<ExhibitorProfile | null> {
    return this.database.withTenant(tenantId, (tx) => this.findOwn(tx, userId));
  }

  /**
   * Creates or replaces the member's profile. Consent keeps its original date while it stays
   * given, and is cleared when withdrawn (Ley 25.326: consent must be provable and revocable).
   */
  async saveOwn(
    tenantId: string,
    userId: string,
    input: ExhibitorProfileInput,
  ): Promise<{ profile: ExhibitorProfile; created: boolean }> {
    try {
      return await this.database.withTenant(tenantId, async (tx) => {
        const before = await this.findOwn(tx, userId, true);
        const publicConsentAt = input.publicContactOptIn
          ? (before?.publicConsentAt ?? new Date())
          : null;
        const values = { ...input, publicConsentAt };
        const [profile] = before
          ? await tx
              .update(exhibitors)
              .set({ ...values, updatedAt: new Date() })
              .where(eq(exhibitors.id, before.id))
              .returning(view)
          : await tx.insert(exhibitors).values({ ...values, userId }).returning(view);
        await this.audit.record(tx, {
          actorId: userId,
          action: before ? 'exhibitor.updated' : 'exhibitor.created',
          entityType: 'exhibitor',
          entityId: profile.id,
          ...(before ? { before } : {}),
          after: profile,
        });
        return { profile, created: !before };
      });
    } catch (error) {
      // Two first saves at once: the (tenant, user) unique key lets only one create it.
      if (isUniqueViolation(error))
        throw new ConflictException('The profile was just created; retry the save.');
      throw error;
    }
  }

  list(tenantId: string): Promise<ExhibitorSummary[]> {
    return this.database.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select(view)
        .from(exhibitors)
        .orderBy(sql`lower(${exhibitors.tradeName})`);
      return rows.map(summary);
    });
  }

  get(tenantId: string, id: string): Promise<ExhibitorSummary | null> {
    return this.database.withTenant(tenantId, async (tx) => {
      const [row] = await tx.select(view).from(exhibitors).where(eq(exhibitors.id, id));
      return row ? summary(row) : null;
    });
  }

  private async findOwn(
    tx: Transaction,
    userId: string,
    forUpdate = false,
  ): Promise<ExhibitorProfile | null> {
    const query = tx.select(view).from(exhibitors).where(eq(exhibitors.userId, userId));
    const [profile] = await (forUpdate ? query.for('update') : query);
    return profile ?? null;
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { and, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import {
  DatabaseService,
  isUniqueViolation,
  type Transaction,
} from '../db/database.service.js';
import {
  exhibitorCategories,
  exhibitorDocuments,
  exhibitors,
} from '../db/schema.js';
import { AuditService } from '../tenancy/audit.service.js';
import {
  deriveDocumentsStatus,
  type DocumentStatus,
  type DocumentsStatus,
} from './document-policy.js';
import type { ExhibitorProfileInput } from './exhibitor.input.js';

const view = {
  id: exhibitors.id,
  legalName: exhibitors.legalName,
  tradeName: exhibitors.tradeName,
  taxId: exhibitors.taxId,
  categoryId: exhibitors.categoryId,
  /** Name of the rubro (EXH-02); null only for rows created before the exhibitor picked one. */
  category: exhibitorCategories.name,
  description: exhibitors.description,
  publicContactOptIn: exhibitors.publicContactOptIn,
  publicConsentAt: exhibitors.publicConsentAt,
  createdAt: exhibitors.createdAt,
  updatedAt: exhibitors.updatedAt,
};

/** Private profile: only its owner and the organizers of its organization see it (INV-08). */
export type ExhibitorProfile = {
  id: string;
  legalName: string;
  tradeName: string;
  taxId: string | null;
  categoryId: string | null;
  category: string | null;
  description: string;
  publicContactOptIn: boolean;
  publicConsentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** `documentsStatus` is derived from the uploaded documents (EXH-03). */
export type { DocumentsStatus };
export type ExhibitorSummary = ExhibitorProfile & {
  documentsStatus: DocumentsStatus;
};

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
        await this.requireCategory(tx, input.categoryId);
        const before = await this.findOwn(tx, userId, true);
        const publicConsentAt = input.publicContactOptIn
          ? (before?.publicConsentAt ?? new Date())
          : null;
        const values = { ...input, publicConsentAt };
        const [saved] = before
          ? await tx
              .update(exhibitors)
              .set({ ...values, updatedAt: new Date() })
              .where(eq(exhibitors.id, before.id))
              .returning({ id: exhibitors.id })
          : await tx
              .insert(exhibitors)
              .values({ ...values, userId })
              .returning({ id: exhibitors.id });
        const profile = await this.read(tx, eq(exhibitors.id, saved.id));
        await this.audit.record(tx, {
          actorId: userId,
          action: before ? 'exhibitor.updated' : 'exhibitor.created',
          entityType: 'exhibitor',
          entityId: profile!.id,
          ...(before ? { before } : {}),
          after: profile,
        });
        return { profile: profile!, created: !before };
      });
    } catch (error) {
      // Two first saves at once: the (tenant, user) unique key lets only one create it.
      if (isUniqueViolation(error))
        throw new ConflictException(
          'The profile was just created; retry the save.',
        );
      throw error;
    }
  }

  list(tenantId: string): Promise<ExhibitorSummary[]> {
    return this.database.withTenant(tenantId, async (tx) => {
      const rows = await this.select(tx).orderBy(
        sql`lower(${exhibitors.tradeName})`,
      );
      const statuses = await this.documentStatuses(tx);
      return rows.map((row) => ({
        ...row,
        documentsStatus: deriveDocumentsStatus(statuses.get(row.id) ?? []),
      }));
    });
  }

  get(tenantId: string, id: string): Promise<ExhibitorSummary | null> {
    return this.database.withTenant(tenantId, async (tx) => {
      const row = await this.read(tx, eq(exhibitors.id, id));
      if (!row) return null;
      const statuses = await this.documentStatuses(tx, id);
      return {
        ...row,
        documentsStatus: deriveDocumentsStatus(statuses.get(id) ?? []),
      };
    });
  }

  private select(tx: Transaction) {
    return tx
      .select(view)
      .from(exhibitors)
      .leftJoin(
        exhibitorCategories,
        and(
          eq(exhibitorCategories.tenantId, exhibitors.tenantId),
          eq(exhibitorCategories.id, exhibitors.categoryId),
        ),
      );
  }

  private async read(
    tx: Transaction,
    where: SQL,
    forUpdate = false,
  ): Promise<ExhibitorProfile | null> {
    const query = this.select(tx).where(where);
    const [profile] = await (forUpdate
      ? query.for('update', { of: exhibitors })
      : query);
    return profile ?? null;
  }

  private findOwn(
    tx: Transaction,
    userId: string,
    forUpdate = false,
  ): Promise<ExhibitorProfile | null> {
    return this.read(tx, eq(exhibitors.userId, userId), forUpdate);
  }

  /** The category must exist in the caller's organization (RLS hides other tenants' rubros). */
  private async requireCategory(tx: Transaction, id: string): Promise<void> {
    const [found] = await tx
      .select({ id: exhibitorCategories.id })
      .from(exhibitorCategories)
      .where(eq(exhibitorCategories.id, id));
    if (!found)
      throw new BadRequestException('Invalid exhibitor profile: categoryId.');
  }

  /** Statuses of the uploaded documents per exhibitor; unconfirmed uploads do not count. */
  private async documentStatuses(
    tx: Transaction,
    exhibitorId?: string,
  ): Promise<Map<string, DocumentStatus[]>> {
    const rows = await tx
      .select({
        exhibitorId: exhibitorDocuments.exhibitorId,
        status: exhibitorDocuments.status,
      })
      .from(exhibitorDocuments)
      .where(
        and(
          isNotNull(exhibitorDocuments.uploadedAt),
          exhibitorId
            ? eq(exhibitorDocuments.exhibitorId, exhibitorId)
            : undefined,
        ),
      );
    const byExhibitor = new Map<string, DocumentStatus[]>();
    for (const row of rows)
      byExhibitor.set(row.exhibitorId, [
        ...(byExhibitor.get(row.exhibitorId) ?? []),
        row.status as DocumentStatus,
      ]);
    return byExhibitor;
  }
}

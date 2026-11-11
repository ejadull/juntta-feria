import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  DatabaseService,
  isReferenceViolation,
  isUniqueViolation,
  type Transaction,
} from '../db/database.service.js';
import { exhibitorCategories } from '../db/schema.js';
import { AuditService } from '../tenancy/audit.service.js';
import type { CategoryInput } from './document.input.js';

export type ExhibitorCategory = {
  id: string;
  name: string;
  createdAt: Date;
  /** How many exhibitors use it; a rubro in use cannot be deleted. */
  exhibitorCount: number;
};

const NOT_FOUND = 'Category not found.';

const view = {
  id: exhibitorCategories.id,
  name: exhibitorCategories.name,
  createdAt: exhibitorCategories.createdAt,
  // Raw names: Drizzle would print the columns unqualified, and `id` would bind to the inner table.
  exhibitorCount: sql<number>`(
    SELECT count(*)::int FROM exhibitors e WHERE e.category_id = exhibitor_categories.id
  )`,
};

/** EXH-02: the organizer curates the rubros of its organization; exhibitors pick one. */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string): Promise<ExhibitorCategory[]> {
    return this.database.withTenant(tenantId, (tx) =>
      tx
        .select(view)
        .from(exhibitorCategories)
        .orderBy(sql`lower(${exhibitorCategories.name})`),
    );
  }

  create(
    tenantId: string,
    actorId: string,
    input: CategoryInput,
  ): Promise<ExhibitorCategory> {
    return this.uniqueName(() =>
      this.database.withTenant(tenantId, async (tx) => {
        const [row] = await tx
          .insert(exhibitorCategories)
          .values({ name: input.name })
          .returning({ id: exhibitorCategories.id });
        const category = await this.read(tx, row.id);
        await this.audit.record(tx, {
          actorId,
          action: 'exhibitor_category.created',
          entityType: 'exhibitor_category',
          entityId: row.id,
          after: category,
        });
        return category;
      }),
    );
  }

  update(
    tenantId: string,
    actorId: string,
    id: string,
    input: CategoryInput,
  ): Promise<ExhibitorCategory> {
    return this.uniqueName(() =>
      this.database.withTenant(tenantId, async (tx) => {
        const before = await this.read(tx, id);
        await tx
          .update(exhibitorCategories)
          .set({ name: input.name })
          .where(eq(exhibitorCategories.id, id));
        const after = await this.read(tx, id);
        await this.audit.record(tx, {
          actorId,
          action: 'exhibitor_category.updated',
          entityType: 'exhibitor_category',
          entityId: id,
          before,
          after,
        });
        return after;
      }),
    );
  }

  async remove(tenantId: string, actorId: string, id: string): Promise<void> {
    try {
      await this.database.withTenant(tenantId, async (tx) => {
        const before = await this.read(tx, id);
        if (before.exhibitorCount > 0) throw this.inUse();
        await tx
          .delete(exhibitorCategories)
          .where(eq(exhibitorCategories.id, id));
        await this.audit.record(tx, {
          actorId,
          action: 'exhibitor_category.deleted',
          entityType: 'exhibitor_category',
          entityId: id,
          before,
        });
      });
    } catch (error) {
      // An exhibitor linked it between the count and the delete: the FK says no.
      if (isReferenceViolation(error)) throw this.inUse();
      throw error;
    }
  }

  private inUse(): ConflictException {
    return new ConflictException({
      message: 'The category is in use by exhibitors and cannot be deleted.',
      code: 'CATEGORY_IN_USE',
    });
  }

  private async read(tx: Transaction, id: string): Promise<ExhibitorCategory> {
    const [row] = await tx
      .select(view)
      .from(exhibitorCategories)
      .where(eq(exhibitorCategories.id, id));
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private async uniqueName<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException({
          message: 'A category with that name already exists.',
          code: 'CATEGORY_EXISTS',
        });
      throw error;
    }
  }
}

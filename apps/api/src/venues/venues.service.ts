import { ConflictException, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  DatabaseService,
  isReferenceViolation,
  isUniqueViolation,
  type Transaction,
} from '../db/database.service.js';
import { venues } from '../db/schema.js';
import { AuditService } from '../tenancy/audit.service.js';
import type { CreateVenueInput, UpdateVenueInput } from './venue.input.js';

/** What the API returns: the tenant is implicit in the request, never echoed. */
const view = {
  id: venues.id,
  type: venues.type,
  name: venues.name,
  address: venues.address,
  timezone: venues.timezone,
  widthM: venues.widthM,
  heightM: venues.heightM,
  createdAt: venues.createdAt,
  updatedAt: venues.updatedAt,
};

export type Venue = Omit<typeof venues.$inferSelect, 'tenantId'>;

const DUPLICATE = 'A venue with that name already exists.';

/**
 * Venue CRUD (VEN-01). Every query runs inside `withTenant`, so RLS limits it to the request
 * tenant; a venue of another tenant simply does not exist (null → 404).
 */
@Injectable()
export class VenuesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string): Promise<Venue[]> {
    return this.database.withTenant(tenantId, (tx) =>
      tx
        .select(view)
        .from(venues)
        .orderBy(sql`lower(${venues.name})`),
    );
  }

  get(tenantId: string, id: string): Promise<Venue | null> {
    return this.database.withTenant(tenantId, (tx) => this.find(tx, id));
  }

  async create(
    tenantId: string,
    actorId: string,
    input: CreateVenueInput,
  ): Promise<Venue> {
    return this.unique(() =>
      this.database.withTenant(tenantId, async (tx) => {
        const [venue] = await tx
          .insert(venues)
          .values({ ...input, address: input.address ?? null })
          .returning(view);
        await this.audit.record(tx, {
          actorId,
          action: 'venue.created',
          entityType: 'venue',
          entityId: venue.id,
          after: venue,
        });
        return venue;
      }),
    );
  }

  async update(
    tenantId: string,
    actorId: string,
    id: string,
    patch: UpdateVenueInput,
  ): Promise<Venue | null> {
    return this.unique(() =>
      this.database.withTenant(tenantId, async (tx) => {
        const before = await this.find(tx, id, true);
        if (!before) return null;
        const [after] = await tx
          .update(venues)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(venues.id, id))
          .returning(view);
        await this.audit.record(tx, {
          actorId,
          action: 'venue.updated',
          entityType: 'venue',
          entityId: id,
          before,
          after,
        });
        return after;
      }),
    );
  }

  async remove(
    tenantId: string,
    actorId: string,
    id: string,
  ): Promise<boolean> {
    return this.database
      .withTenant(tenantId, async (tx) => {
        const [before] = await tx
          .delete(venues)
          .where(eq(venues.id, id))
          .returning(view);
        if (!before) return false;
        await this.audit.record(tx, {
          actorId,
          action: 'venue.deleted',
          entityType: 'venue',
          entityId: id,
          before,
        });
        return true;
      })
      .catch((error: unknown) => {
        // Layout templates (and later events) keep the venue with ON DELETE RESTRICT.
        if (isReferenceViolation(error))
          throw new ConflictException('The venue is in use by a layout template.');
        throw error;
      });
  }

  private async find(
    tx: Transaction,
    id: string,
    forUpdate = false,
  ): Promise<Venue | null> {
    const query = tx.select(view).from(venues).where(eq(venues.id, id));
    const [venue] = await (forUpdate ? query.for('update') : query);
    return venue ?? null;
  }

  /** The case-insensitive name index is the source of truth for duplicates (no check-then-insert race). */
  private async unique<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE);
      throw error;
    }
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  DatabaseService,
  isUniqueViolation,
  type Transaction,
} from '../db/database.service.js';
import { events, eventSectors, eventStands } from '../db/schema.js';
import { AuditService } from '../tenancy/audit.service.js';
import type {
  CreateSectorInput,
  UpdateSectorInput,
  UpdateStandsInput,
} from './event.input.js';
import { EVENT_NOT_FOUND } from './events.service.js';

const standView = {
  id: eventStands.id,
  layoutObjectId: eventStands.layoutObjectId,
  code: eventStands.code,
  sectorId: eventStands.sectorId,
  status: eventStands.status,
  // NULL in the database means "no tariff yet" (it blocks publishing, §4.1); the API shows it as
  // 0 with hasPrice=false so clients never handle null and never confuse it with a free stand.
  priceCents: sql<number>`coalesce(${eventStands.priceCents}, 0)`.mapWith(
    Number,
  ),
  hasPrice: sql<boolean>`${eventStands.priceCents} IS NOT NULL`,
  currency: eventStands.currency,
};

const sectorView = {
  id: eventSectors.id,
  name: eventSectors.name,
  sortOrder: eventSectors.sortOrder,
};

export interface EventStand {
  readonly id: string;
  readonly layoutObjectId: string;
  readonly code: string;
  readonly sectorId: string | null;
  readonly status: (typeof eventStands.$inferSelect)['status'];
  readonly priceCents: number;
  readonly hasPrice: boolean;
  readonly currency: string;
}
export type EventSector = {
  [K in keyof typeof sectorView]: (typeof eventSectors.$inferSelect)[K];
};

const SECTOR_NOT_FOUND = 'Sector not found.';
const DUPLICATE_SECTOR = 'A sector with that name already exists in the event.';

/**
 * Priced inventory and sectors of an event (EVT-01, ADR 0002). Prices may change after publishing:
 * reservations freeze their own price (INV-05), so only new reservations see the change.
 */
@Injectable()
export class EventInventoryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  listStands(tenantId: string, eventId: string): Promise<EventStand[]> {
    return this.database.withTenant(tenantId, async (tx) => {
      await this.requireEvent(tx, eventId);
      return tx
        .select(standView)
        .from(eventStands)
        .where(eq(eventStands.eventId, eventId))
        .orderBy(sql`length(${eventStands.code})`, asc(eventStands.code));
    });
  }

  updateStands(
    tenantId: string,
    actorId: string,
    eventId: string,
    patch: UpdateStandsInput,
  ): Promise<EventStand[]> {
    return this.database.withTenant(tenantId, async (tx) => {
      await this.requireEvent(tx, eventId);
      const { standIds, ...changes } = patch;
      const targets = await tx
        .select({ id: eventStands.id, status: eventStands.status })
        .from(eventStands)
        .where(
          and(
            eq(eventStands.eventId, eventId),
            inArray(eventStands.id, standIds),
          ),
        )
        .for('update');
      if (targets.length !== standIds.length)
        throw new BadRequestException(
          'Invalid stands: some stands do not belong to the event.',
        );
      if (changes.status && targets.some((s) => s.status === 'ASSIGNED'))
        throw new ConflictException(
          'An assigned stand cannot change its status.',
        );
      if (changes.sectorId)
        await this.requireSector(
          tx,
          eventId,
          changes.sectorId,
          BadRequestException,
        );

      const updated = await tx
        .update(eventStands)
        .set({ ...changes, updatedAt: new Date() })
        .where(inArray(eventStands.id, standIds))
        .returning(standView);
      await this.audit.record(tx, {
        actorId,
        action: 'event_stands.updated',
        entityType: 'event',
        entityId: eventId,
        after: { standIds, ...changes },
      });
      return updated;
    });
  }

  listSectors(tenantId: string, eventId: string): Promise<EventSector[]> {
    return this.database.withTenant(tenantId, async (tx) => {
      await this.requireEvent(tx, eventId);
      return tx
        .select(sectorView)
        .from(eventSectors)
        .where(eq(eventSectors.eventId, eventId))
        .orderBy(asc(eventSectors.sortOrder), sql`lower(${eventSectors.name})`);
    });
  }

  createSector(
    tenantId: string,
    actorId: string,
    eventId: string,
    input: CreateSectorInput,
  ): Promise<EventSector> {
    return this.uniqueName(() =>
      this.database.withTenant(tenantId, async (tx) => {
        await this.requireEvent(tx, eventId);
        const [sector] = await tx
          .insert(eventSectors)
          .values({ eventId, ...input })
          .returning(sectorView);
        await this.audit.record(tx, {
          actorId,
          action: 'event_sector.created',
          entityType: 'event_sector',
          entityId: sector.id,
          after: sector,
        });
        return sector;
      }),
    );
  }

  updateSector(
    tenantId: string,
    actorId: string,
    eventId: string,
    sectorId: string,
    patch: UpdateSectorInput,
  ): Promise<EventSector> {
    return this.uniqueName(() =>
      this.database.withTenant(tenantId, async (tx) => {
        const before = await this.requireSector(
          tx,
          eventId,
          sectorId,
          NotFoundException,
        );
        const [after] = await tx
          .update(eventSectors)
          .set(patch)
          .where(eq(eventSectors.id, sectorId))
          .returning(sectorView);
        await this.audit.record(tx, {
          actorId,
          action: 'event_sector.updated',
          entityType: 'event_sector',
          entityId: sectorId,
          before,
          after,
        });
        return after;
      }),
    );
  }

  /** Its stands keep existing without sector (FK ON DELETE SET NULL (sector_id), ADR 0002). */
  removeSector(
    tenantId: string,
    actorId: string,
    eventId: string,
    sectorId: string,
  ): Promise<void> {
    return this.database.withTenant(tenantId, async (tx) => {
      const before = await this.requireSector(
        tx,
        eventId,
        sectorId,
        NotFoundException,
      );
      await tx.delete(eventSectors).where(eq(eventSectors.id, sectorId));
      await this.audit.record(tx, {
        actorId,
        action: 'event_sector.deleted',
        entityType: 'event_sector',
        entityId: sectorId,
        before,
      });
    });
  }

  private async requireEvent(tx: Transaction, eventId: string): Promise<void> {
    const [event] = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, eventId));
    if (!event) throw new NotFoundException(EVENT_NOT_FOUND);
  }

  /** A sector of another event is "not found" (404 on its routes, 400 inside a stand update). */
  private async requireSector(
    tx: Transaction,
    eventId: string,
    sectorId: string,
    error: new (message: string) => Error,
  ): Promise<EventSector> {
    const [sector] = await tx
      .select(sectorView)
      .from(eventSectors)
      .where(
        and(eq(eventSectors.id, sectorId), eq(eventSectors.eventId, eventId)),
      );
    if (!sector) throw new error(SECTOR_NOT_FOUND);
    return sector;
  }

  private async uniqueName<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(DUPLICATE_SECTOR);
      throw error;
    }
  }
}

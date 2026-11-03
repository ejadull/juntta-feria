import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  DatabaseService,
  isUniqueViolation,
  type Transaction,
} from '../db/database.service.js';
import {
  events,
  eventStands,
  layoutTemplates,
  layoutVersions,
  venues,
} from '../db/schema.js';
import { AuditService } from '../tenancy/audit.service.js';
import {
  datesProblem,
  slugify,
  type CreateEventInput,
  type UpdateEventInput,
} from './event.input.js';

const view = {
  id: events.id,
  venueId: events.venueId,
  layoutVersionId: events.layoutVersionId,
  name: events.name,
  slug: events.slug,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  salesOpenAt: events.salesOpenAt,
  salesCloseAt: events.salesCloseAt,
  status: events.status,
  publishedAt: events.publishedAt,
  createdAt: events.createdAt,
  updatedAt: events.updatedAt,
};

export type Event = Omit<typeof events.$inferSelect, 'tenantId'>;

export interface EventIssue {
  readonly code: 'STAND_WITHOUT_PRICE' | 'NO_SELLABLE_STANDS';
  readonly objectIds: readonly string[];
  readonly message: string;
}

export const EVENT_NOT_FOUND = 'Event not found.';
const DUPLICATE_SLUG = 'An event with that slug already exists.';
const NOT_DRAFT = 'Only a draft event can change.';

/**
 * Events (EVT-01). Created on a PUBLISHED layout version with one stand per STAND object;
 * published only when every sellable stand has a price (§4.1). All queries run in `withTenant`.
 */
@Injectable()
export class EventsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string): Promise<Event[]> {
    return this.database.withTenant(tenantId, (tx) =>
      tx.select(view).from(events).orderBy(desc(events.startsAt)),
    );
  }

  get(tenantId: string, id: string): Promise<Event | null> {
    return this.database.withTenant(tenantId, (tx) => this.find(tx, id));
  }

  create(tenantId: string, actorId: string, input: CreateEventInput): Promise<Event> {
    return this.uniqueSlug(() =>
      this.database.withTenant(tenantId, async (tx) => {
        await this.checkLayout(tx, input.venueId, input.layoutVersionId);
        const { slug, ...data } = input;
        const [event] = await tx
          .insert(events)
          .values({ ...data, slug: slug ?? slugify(input.name) })
          .returning(view);
        await tx.execute(sql`
          INSERT INTO event_stands (event_id, layout_version_id, layout_object_id, code)
          SELECT ${event.id}, layout_version_id, id, btrim(code)
          FROM layout_objects
          WHERE layout_version_id = ${input.layoutVersionId} AND kind = 'STAND'`);
        await this.audit.record(tx, {
          actorId,
          action: 'event.created',
          entityType: 'event',
          entityId: event.id,
          after: event,
        });
        return event;
      }),
    );
  }

  update(
    tenantId: string,
    actorId: string,
    id: string,
    patch: UpdateEventInput,
  ): Promise<Event | null> {
    return this.uniqueSlug(() =>
      this.database.withTenant(tenantId, async (tx) => {
        const before = await this.find(tx, id, true);
        if (!before) return null;
        if (before.status !== 'DRAFT') throw new ConflictException(NOT_DRAFT);
        const problem = datesProblem({ ...before, ...patch });
        if (problem) throw new BadRequestException(`Invalid event: ${problem}.`);
        const [after] = await tx
          .update(events)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(events.id, id))
          .returning(view);
        await this.audit.record(tx, {
          actorId,
          action: 'event.updated',
          entityType: 'event',
          entityId: id,
          before,
          after,
        });
        return after;
      }),
    );
  }

  publish(tenantId: string, actorId: string, id: string): Promise<Event> {
    return this.database.withTenant(tenantId, async (tx) => {
      const event = await this.find(tx, id, true);
      if (!event) throw new NotFoundException(EVENT_NOT_FOUND);
      if (event.status !== 'DRAFT') throw new ConflictException(NOT_DRAFT);
      const issues = await this.publishIssues(tx, id);
      if (issues.length > 0)
        throw new UnprocessableEntityException({
          message: `The event has ${issues.length} issue(s) and cannot be published.`,
          issues,
        });
      const [published] = await tx
        .update(events)
        .set({ status: 'PUBLISHED', publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(events.id, id))
        .returning(view);
      await this.audit.record(tx, {
        actorId,
        action: 'event.published',
        entityType: 'event',
        entityId: id,
        after: { status: published.status, publishedAt: published.publishedAt },
      });
      return published;
    });
  }

  /** Same tenant venue and PUBLISHED layout (INV-03); a template tied to a venue only serves it. */
  private async checkLayout(tx: Transaction, venueId: string, versionId: string): Promise<void> {
    const [venue] = await tx.select({ id: venues.id }).from(venues).where(eq(venues.id, venueId));
    if (!venue) throw new NotFoundException('Venue not found.');
    const [layout] = await tx
      .select({ status: layoutVersions.status, templateVenueId: layoutTemplates.venueId })
      .from(layoutVersions)
      .innerJoin(layoutTemplates, eq(layoutTemplates.id, layoutVersions.templateId))
      .where(eq(layoutVersions.id, versionId));
    if (!layout) throw new NotFoundException('Layout not found.');
    if (layout.status !== 'PUBLISHED')
      throw new ConflictException('The layout version must be published (INV-03).');
    if (layout.templateVenueId && layout.templateVenueId !== venueId)
      throw new BadRequestException('Invalid event: the layout belongs to another venue.');
  }

  private async publishIssues(tx: Transaction, eventId: string): Promise<EventIssue[]> {
    const unpriced = await tx
      .select({ id: eventStands.id })
      .from(eventStands)
      .where(
        and(
          eq(eventStands.eventId, eventId),
          ne(eventStands.status, 'DISABLED'),
          isNull(eventStands.priceCents),
        ),
      )
      .orderBy(eventStands.code);
    const [{ sellable }] = await tx
      .select({ sellable: sql<number>`count(*)::int` })
      .from(eventStands)
      .where(and(eq(eventStands.eventId, eventId), eq(eventStands.status, 'AVAILABLE')));
    const issues: EventIssue[] = [];
    if (unpriced.length > 0)
      issues.push({
        code: 'STAND_WITHOUT_PRICE',
        objectIds: unpriced.map((s) => s.id),
        message: 'Every stand that is not disabled needs a price.',
      });
    if (sellable === 0)
      issues.push({
        code: 'NO_SELLABLE_STANDS',
        objectIds: [],
        message: 'The event has no available stands.',
      });
    return issues;
  }

  private async find(tx: Transaction, id: string, forUpdate = false): Promise<Event | null> {
    const query = tx.select(view).from(events).where(eq(events.id, id));
    const [event] = await (forUpdate ? query.for('update') : query);
    return event ?? null;
  }

  private async uniqueSlug<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE_SLUG);
      throw error;
    }
  }
}

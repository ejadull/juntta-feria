import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  DatabaseService,
  isUniqueViolation,
  type Transaction,
} from '../db/database.service.js';
import {
  ACTIVE_RESERVATION_STATUSES,
  events,
  eventStands,
  exhibitors,
  layoutObjects,
  platformSubscriptions,
  reservations,
  users,
  type ReservationStatus,
} from '../db/schema.js';
import { AuditService } from '../tenancy/audit.service.js';
import type { CreateReservationInput } from './reservation.input.js';

/** ponytail: fixed hold; move to RESERVATION_HOLD_MINUTES (§13.1) when organizers need to tune it. */
export const HOLD_MINUTES = 15;
const SELLING: readonly string[] = ['PUBLISHED', 'ACTIVE'];

export interface ReservationView {
  readonly id: string;
  readonly status: ReservationStatus;
  readonly holdExpiresAt: Date | null;
  readonly amount: { readonly currency: string; readonly valueCents: number };
  readonly stand: { readonly id: string; readonly code: string; readonly areaM2: number };
  readonly eventId: string;
  readonly exhibitorId: string;
  readonly termsVersion: string;
  readonly createdAt: Date;
}

/** HttpException carrying the §5 machine-readable `code` (problem+json extension). */
export const fail = (
  Exception: new (body: object) => HttpException,
  code: string,
  message: string,
): HttpException => new Exception({ message, code });

const isExpiredHold = (status: string, holdExpiresAt: Date | null, now: Date) =>
  status === 'HELD' && !!holdExpiresAt && holdExpiresAt <= now;

/**
 * Reservations (RES-01, §6). A hold locks the event stand row, so two exhibitors on the same
 * stand are serialized; the partial unique index is the last line of defense (INV-01).
 */
@Injectable()
export class ReservationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async hold(
    tenantId: string,
    userId: string,
    idempotencyKey: string,
    input: CreateReservationInput,
  ): Promise<{ reservation: ReservationView; replayed: boolean }> {
    try {
      return await this.database.withTenant(tenantId, (tx) =>
        this.holdIn(tx, userId, idempotencyKey, input),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Same key sent twice at once: the first one won; answer with it.
      const replay = await this.database.withTenant(tenantId, (tx) =>
        this.byIdempotencyKey(tx, userId, idempotencyKey),
      );
      if (replay) return { reservation: replay, replayed: true };
      throw fail(ConflictException, 'STAND_UNAVAILABLE', 'The stand is no longer available.');
    }
  }

  list(tenantId: string, ownerId: string | null, eventId?: string): Promise<ReservationView[]> {
    const filters: SQL[] = [];
    if (ownerId) filters.push(eq(reservations.userId, ownerId));
    if (eventId) filters.push(eq(eventStands.eventId, eventId));
    return this.database.withTenant(tenantId, (tx) => this.select(tx, filters));
  }

  async get(tenantId: string, id: string, ownerId: string | null): Promise<ReservationView | null> {
    const [reservation] = await this.database.withTenant(tenantId, (tx) =>
      this.select(tx, this.scope(id, ownerId)),
    );
    return reservation ?? null;
  }

  /** Releases a live hold. Paid states go through refunds (PAY-06), not through this. */
  cancel(tenantId: string, actorId: string, id: string, ownerId: string | null): Promise<ReservationView> {
    return this.database.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ status: reservations.status, holdExpiresAt: reservations.holdExpiresAt })
        .from(reservations)
        .where(and(...this.scope(id, ownerId)))
        .for('update');
      if (!row) throw new NotFoundException('Reservation not found.');
      if (row.status !== 'HELD' || isExpiredHold(row.status, row.holdExpiresAt, new Date()))
        throw fail(ConflictException, 'RESERVATION_NOT_CANCELLABLE', 'Only a live hold can be cancelled.');
      await tx
        .update(reservations)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(eq(reservations.id, id));
      await this.audit.record(tx, {
        actorId,
        action: 'reservation.cancelled',
        entityType: 'reservation',
        entityId: id,
        before: { status: row.status },
        after: { status: 'CANCELLED' },
      });
      const [view] = await this.select(tx, [eq(reservations.id, id)]);
      return view;
    });
  }

  private async holdIn(
    tx: Transaction,
    userId: string,
    idempotencyKey: string,
    input: CreateReservationInput,
  ): Promise<{ reservation: ReservationView; replayed: boolean }> {
    const previous = await this.byIdempotencyKey(tx, userId, idempotencyKey);
    if (previous) {
      if (previous.stand.id !== input.eventStandId)
        throw fail(UnprocessableEntityException, 'IDEMPOTENCY_KEY_REUSED', 'The Idempotency-Key was used for another request.');
      return { reservation: previous, replayed: true };
    }

    const now = new Date();
    const exhibitorId = await this.eligibleExhibitor(tx, userId, input.exhibitorId, now);

    const [stand] = await tx
      .select({
        id: eventStands.id,
        eventId: eventStands.eventId,
        status: eventStands.status,
        priceCents: eventStands.priceCents,
        currency: eventStands.currency,
        eventStatus: events.status,
        salesOpenAt: events.salesOpenAt,
        salesCloseAt: events.salesCloseAt,
      })
      .from(eventStands)
      .innerJoin(events, eq(events.id, eventStands.eventId))
      .where(eq(eventStands.id, input.eventStandId))
      .for('update', { of: eventStands });
    if (!stand) throw new NotFoundException('Stand not found.');
    if (!SELLING.includes(stand.eventStatus) || now < stand.salesOpenAt || now > stand.salesCloseAt)
      throw fail(UnprocessableEntityException, 'EVENT_SALES_CLOSED', 'Sales for this event are closed.');
    if (stand.status !== 'AVAILABLE' || stand.priceCents === null)
      throw fail(ConflictException, 'STAND_UNAVAILABLE', 'The stand is not available.');

    await this.releaseOrRefuse(tx, stand.id, now);
    await this.checkHoldLimit(tx, exhibitorId, stand.eventId, now);

    const [created] = await tx
      .insert(reservations)
      .values({
        eventStandId: stand.id,
        exhibitorId,
        userId,
        status: 'HELD',
        holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
        priceCents: stand.priceCents,
        currency: stand.currency,
        termsVersion: input.termsVersion,
        idempotencyKey,
      })
      .returning({ id: reservations.id });
    await this.audit.record(tx, {
      actorId: userId,
      action: 'reservation.held',
      entityType: 'reservation',
      entityId: created.id,
      after: { eventStandId: stand.id, exhibitorId, priceCents: stand.priceCents, currency: stand.currency },
    });
    const [reservation] = await this.select(tx, [eq(reservations.id, created.id)]);
    return { reservation, replayed: false };
  }

  /** §6.1 + EXH-04/EXH-05: confirmed account, complete own profile, active platform subscription. */
  private async eligibleExhibitor(
    tx: Transaction,
    userId: string,
    requestedExhibitorId: string | undefined,
    now: Date,
  ): Promise<string> {
    const [user] = await tx.select({ confirmedAt: users.confirmedAt }).from(users).where(eq(users.id, userId));
    if (!user?.confirmedAt)
      throw fail(ForbiddenException, 'ACCOUNT_NOT_CONFIRMED', 'Confirm your account before reserving.');
    const [profile] = await tx
      .select({ id: exhibitors.id, taxId: exhibitors.taxId })
      .from(exhibitors)
      .where(eq(exhibitors.userId, userId));
    if (!profile?.taxId)
      throw fail(ForbiddenException, 'PROFILE_INCOMPLETE', 'Complete your exhibitor profile, including your CUIT.');
    if (requestedExhibitorId && requestedExhibitorId !== profile.id)
      throw fail(ForbiddenException, 'EXHIBITOR_NOT_AUTHORIZED', 'You can only reserve for your own exhibitor profile.');
    const [subscription] = await tx
      .select({ status: platformSubscriptions.status, end: platformSubscriptions.currentPeriodEnd })
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.userId, userId));
    if (subscription?.status !== 'ACTIVE' || subscription.end <= now)
      throw fail(ForbiddenException, 'SUBSCRIPTION_REQUIRED', 'An active subscription is required to reserve.');
    return profile.id;
  }

  /** §6.3: an expired hold is released on the spot (no payment can be in flight for a HELD one). */
  private async releaseOrRefuse(tx: Transaction, standId: string, now: Date): Promise<void> {
    const [active] = await tx
      .select({ id: reservations.id, status: reservations.status, holdExpiresAt: reservations.holdExpiresAt })
      .from(reservations)
      .where(
        and(eq(reservations.eventStandId, standId), inArray(reservations.status, [...ACTIVE_RESERVATION_STATUSES])),
      )
      .for('update');
    if (!active) return;
    if (!isExpiredHold(active.status, active.holdExpiresAt, now))
      throw fail(ConflictException, 'STAND_UNAVAILABLE', 'The stand is not available.');
    await tx
      .update(reservations)
      .set({ status: 'EXPIRED', updatedAt: now })
      .where(eq(reservations.id, active.id));
    await this.audit.record(tx, {
      actorId: null,
      action: 'reservation.expired',
      entityType: 'reservation',
      entityId: active.id,
      before: { status: 'HELD', holdExpiresAt: active.holdExpiresAt },
      after: { status: 'EXPIRED' },
    });
  }

  /** "Un stand por checkout" (§1.5): one live reservation per exhibitor and event. */
  private async checkHoldLimit(tx: Transaction, exhibitorId: string, eventId: string, now: Date): Promise<void> {
    const [{ live }] = await tx
      .select({ live: sql<number>`count(*)::int` })
      .from(reservations)
      .innerJoin(eventStands, eq(eventStands.id, reservations.eventStandId))
      .where(
        and(
          eq(reservations.exhibitorId, exhibitorId),
          eq(eventStands.eventId, eventId),
          inArray(reservations.status, [...ACTIVE_RESERVATION_STATUSES]),
          sql`NOT (${reservations.status} = 'HELD' AND ${reservations.holdExpiresAt} <= ${now})`,
        ),
      );
    if (live > 0)
      throw fail(ConflictException, 'HOLD_LIMIT', 'You already have a reservation in this event.');
  }

  private async byIdempotencyKey(tx: Transaction, userId: string, key: string): Promise<ReservationView | null> {
    const [reservation] = await this.select(tx, [
      eq(reservations.userId, userId),
      eq(reservations.idempotencyKey, key),
    ]);
    return reservation ?? null;
  }

  private scope(id: string, ownerId: string | null): SQL[] {
    return ownerId ? [eq(reservations.id, id), eq(reservations.userId, ownerId)] : [eq(reservations.id, id)];
  }

  /** Read model; a HELD reservation past its expiry reads as EXPIRED before anyone writes it. */
  private async select(tx: Transaction, filters: SQL[]): Promise<ReservationView[]> {
    const rows = await tx
      .select({
        id: reservations.id,
        status: reservations.status,
        holdExpiresAt: reservations.holdExpiresAt,
        priceCents: reservations.priceCents,
        currency: reservations.currency,
        termsVersion: reservations.termsVersion,
        exhibitorId: reservations.exhibitorId,
        createdAt: reservations.createdAt,
        standId: eventStands.id,
        standCode: eventStands.code,
        eventId: eventStands.eventId,
        areaM2: sql<number>`round(ST_Area(${layoutObjects.geometry})::numeric, 2)`.mapWith(Number),
      })
      .from(reservations)
      .innerJoin(eventStands, eq(eventStands.id, reservations.eventStandId))
      .innerJoin(
        layoutObjects,
        and(
          eq(layoutObjects.layoutVersionId, eventStands.layoutVersionId),
          eq(layoutObjects.id, eventStands.layoutObjectId),
        ),
      )
      .where(and(...filters))
      .orderBy(desc(reservations.createdAt));
    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      status: isExpiredHold(r.status, r.holdExpiresAt, now) ? 'EXPIRED' : r.status,
      holdExpiresAt: r.holdExpiresAt,
      amount: { currency: r.currency, valueCents: r.priceCents },
      stand: { id: r.standId, code: r.standCode, areaM2: r.areaM2 },
      eventId: r.eventId,
      exhibitorId: r.exhibitorId,
      termsVersion: r.termsVersion,
      createdAt: r.createdAt,
    }));
  }
}

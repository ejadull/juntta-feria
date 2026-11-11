import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service.js';
import { eventSectors, events, venues } from '../db/schema.js';
import { EVENT_NOT_FOUND } from './events.service.js';

export const DEFAULT_METRIC_DAYS = 30;
export const MAX_METRIC_DAYS = 90;

export type StandBucket =
  'available' | 'held' | 'pending' | 'confirmed' | 'blocked';

/**
 * Read model of `GET /events/:id/metrics` (REP-01). The first block mirrors `EventMetricsDto` of
 * the web dashboard (org-ui-shell D2) so its adapter can be swapped without changes; the rest are
 * the REP-01 additions. Money is integer ARS cents.
 */
export interface EventMetrics {
  readonly eventId: string;
  readonly eventName: string;
  readonly venueName: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly layoutVersionId: string;
  /** Stands that are not DISABLED. */
  readonly sellableStands: number;
  readonly blockedStands: number;
  /** Stands with a confirmed reservation. */
  readonly assignedStands: number;
  /** Payments approved for reservations that are CONFIRMED. */
  readonly approvedGmvCents: number;
  readonly currency: 'ARS';
  /** HELD + PAYMENT_PENDING reservations. */
  readonly activeReservations: number;
  /** Checkouts still waiting for the provider's answer. */
  readonly reconciliationPending: number;
  readonly gmvByMonth: readonly { month: string; cents: number }[];
  readonly stands: Readonly<Record<StandBucket, number>> & { total: number };
  /** Price of the reservations that hold a stand but are not paid yet. */
  readonly pendingAmountCents: number;
  readonly reservationsByDay: readonly { day: string; count: number }[];
  /** `LATE_PAYMENT_CONFLICT` incidents of this event (INV-07). */
  readonly latePaymentIncidents: number;
  readonly occupancyBySector: readonly {
    sectorId: string | null;
    name: string | null;
    sellable: number;
    assigned: number;
  }[];
}

type Row = Record<string, unknown>;
interface SectorCount {
  sellable: number;
  assigned: number;
}

const BUCKETS: readonly StandBucket[] = [
  'available',
  'held',
  'pending',
  'confirmed',
  'blocked',
];

/** Stand of the event with the state of its (single) live reservation (INV-01). */
const standBuckets = (eventId: string) => sql`
  SELECT s.sector_id AS "sectorId",
    CASE
      WHEN s.status = 'BLOCKED' THEN 'blocked'
      WHEN r.status = 'HELD' THEN 'held'
      WHEN r.status = 'PAYMENT_PENDING' THEN 'pending'
      WHEN r.status IN ('CONFIRMED', 'REFUND_PENDING') OR s.status = 'ASSIGNED' THEN 'confirmed'
      ELSE 'available'
    END AS bucket,
    count(*)::int AS n
  FROM event_stands s
  LEFT JOIN reservations r ON r.event_stand_id = s.id
    AND r.status IN ('HELD', 'PAYMENT_PENDING', 'CONFIRMED', 'REFUND_PENDING')
  WHERE s.event_id = ${eventId} AND s.status <> 'DISABLED'
  GROUP BY 1, 2`;

/** Dashboard KPIs (REP-01). Every query runs in `withTenant`, so RLS keeps it to one tenant. */
@Injectable()
export class EventMetricsService {
  constructor(private readonly database: DatabaseService) {}

  get(
    tenantId: string,
    eventId: string,
    days = DEFAULT_METRIC_DAYS,
  ): Promise<EventMetrics> {
    return this.database.withTenant(tenantId, async (tx) => {
      const [event] = await tx
        .select({
          eventName: events.name,
          venueName: venues.name,
          startsAt: events.startsAt,
          endsAt: events.endsAt,
          layoutVersionId: events.layoutVersionId,
        })
        .from(events)
        .innerJoin(
          venues,
          and(
            eq(venues.tenantId, events.tenantId),
            eq(venues.id, events.venueId),
          ),
        )
        .where(eq(events.id, eventId));
      if (!event) throw new NotFoundException(EVENT_NOT_FOUND);

      const standRows = (await tx.execute(standBuckets(eventId))).rows as Row[];
      const sectorRows = await tx
        .select({ id: eventSectors.id, name: eventSectors.name })
        .from(eventSectors)
        .where(eq(eventSectors.eventId, eventId))
        .orderBy(eventSectors.sortOrder, eventSectors.name);

      const money = (
        await tx.execute(sql`
          SELECT
            coalesce(sum(a.amount_cents) FILTER (WHERE a.status = 'APPROVED' AND r.status = 'CONFIRMED'), 0)::text AS approved,
            (count(*) FILTER (WHERE a.status = 'PENDING'))::int AS "reconciliationPending"
          FROM payment_attempts a
          JOIN reservations r ON r.id = a.reservation_id
          JOIN event_stands s ON s.id = r.event_stand_id
          WHERE s.event_id = ${eventId}`)
      ).rows[0] as Row;
      const months = (
        await tx.execute(sql`
          SELECT to_char(a.updated_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
                 sum(a.amount_cents)::text AS cents
          FROM payment_attempts a
          JOIN reservations r ON r.id = a.reservation_id
          JOIN event_stands s ON s.id = r.event_stand_id
          WHERE s.event_id = ${eventId} AND a.status = 'APPROVED' AND r.status = 'CONFIRMED'
          GROUP BY 1 ORDER BY 1`)
      ).rows as Row[];
      const pending = (
        await tx.execute(sql`
          SELECT coalesce(sum(r.price_cents), 0)::text AS cents, count(*)::int AS n
          FROM reservations r
          JOIN event_stands s ON s.id = r.event_stand_id
          WHERE s.event_id = ${eventId} AND r.status IN ('HELD', 'PAYMENT_PENDING')`)
      ).rows[0] as Row;
      const byDay = (
        await tx.execute(sql`
          SELECT to_char(d, 'YYYY-MM-DD') AS day, count(x.id)::int AS count
          FROM generate_series(
                 (now() AT TIME ZONE 'UTC')::date - (${days}::int - 1),
                 (now() AT TIME ZONE 'UTC')::date, interval '1 day') AS d
          LEFT JOIN (
            SELECT r.id, (r.created_at AT TIME ZONE 'UTC')::date AS day
            FROM reservations r
            JOIN event_stands s ON s.id = r.event_stand_id
            WHERE s.event_id = ${eventId}
          ) x ON x.day = d::date
          GROUP BY d ORDER BY d`)
      ).rows as Row[];
      const late = (
        await tx.execute(sql`
          SELECT count(*)::int AS n FROM audit_logs l
          WHERE l.action = 'payment.late_conflict' AND l.entity_type = 'reservation'
            AND l.entity_id IN (
              SELECT r.id FROM reservations r
              JOIN event_stands s ON s.id = r.event_stand_id
              WHERE s.event_id = ${eventId})`)
      ).rows[0] as Row;

      const stands = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<
        StandBucket,
        number
      >;
      const bySector = new Map<string | null, SectorCount>([
        ...sectorRows.map((s): [string | null, SectorCount] => [
          s.id,
          { sellable: 0, assigned: 0 },
        ]),
        [null, { sellable: 0, assigned: 0 }],
      ]);
      for (const row of standRows) {
        const bucket = row.bucket as StandBucket;
        const n = Number(row.n);
        stands[bucket] += n;
        const sector = bySector.get((row.sectorId as string | null) ?? null);
        if (sector) {
          sector.sellable += n;
          if (bucket === 'confirmed') sector.assigned += n;
        }
      }
      const total = BUCKETS.reduce((sum, b) => sum + stands[b], 0);
      const unassigned = bySector.get(null)!;

      return {
        eventId,
        eventName: event.eventName,
        venueName: event.venueName,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        layoutVersionId: event.layoutVersionId,
        sellableStands: total,
        blockedStands: stands.blocked,
        assignedStands: stands.confirmed,
        approvedGmvCents: Number(money.approved),
        currency: 'ARS' as const,
        activeReservations: Number(pending.n),
        reconciliationPending: Number(money.reconciliationPending),
        gmvByMonth: months.map((m) => ({
          month: m.month as string,
          cents: Number(m.cents),
        })),
        stands: { ...stands, total },
        pendingAmountCents: Number(pending.cents),
        reservationsByDay: byDay.map((d) => ({
          day: d.day as string,
          count: Number(d.count),
        })),
        latePaymentIncidents: Number(late.n),
        occupancyBySector: [
          ...sectorRows.map((s) => ({
            sectorId: s.id as string | null,
            name: s.name as string | null,
            ...bySector.get(s.id)!,
          })),
          ...(unassigned.sellable > 0
            ? [{ sectorId: null, name: null, ...unassigned }]
            : []),
        ],
      };
    });
  }
}

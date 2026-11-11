import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service.js';
import { events } from '../db/schema.js';
import { csvDocument, type CsvValue } from './csv.js';
import { EVENT_NOT_FOUND } from './events.service.js';

export interface ReservationsExport {
  readonly filename: string;
  readonly csv: string;
}

const HEADER = [
  'Stand',
  'Sector',
  'Expositor',
  'Email',
  'Estado',
  'Monto (ARS)',
  'Creada',
  'Actualizada',
  'Estado del pago',
  'ID de pago',
];

type Row = Record<string, unknown>;
const text = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
/** Raw rows come back as driver strings; format instants as ISO 8601 UTC in SQL. */
const utc = (column: SQL) =>
  sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const ars = (cents: unknown): string => (Number(cents) / 100).toFixed(2);

/** REP-01: every reservation of one event as CSV. Runs in `withTenant`, so RLS bounds it to the tenant. */
@Injectable()
export class ReservationsExportService {
  constructor(private readonly database: DatabaseService) {}

  export(
    tenantId: string,
    eventId: string,
    today = new Date(),
  ): Promise<ReservationsExport> {
    return this.database.withTenant(tenantId, async (tx) => {
      const [event] = await tx
        .select({ slug: events.slug })
        .from(events)
        .where(eq(events.id, eventId));
      if (!event) throw new NotFoundException(EVENT_NOT_FOUND);

      const rows = (
        await tx.execute(sql`
          SELECT s.code, sec.name AS sector, x.trade_name, u.email, r.status,
                 r.price_cents::text AS price, ${utc(sql`r.created_at`)} AS created_at, ${utc(sql`r.updated_at`)} AS updated_at,
                 a.payment_status, a.payment_id
          FROM reservations r
          JOIN event_stands s ON s.id = r.event_stand_id
          LEFT JOIN event_sectors sec ON sec.id = s.sector_id
          JOIN exhibitors x ON x.id = r.exhibitor_id
          JOIN users u ON u.id = x.user_id
          LEFT JOIN LATERAL (
            SELECT p.payment_status, p.payment_id FROM payment_attempts p
            WHERE p.reservation_id = r.id ORDER BY p.created_at DESC, p.id LIMIT 1
          ) a ON true
          WHERE s.event_id = ${eventId}
          ORDER BY s.code, r.created_at`)
      ).rows as Row[];

      const lines: CsvValue[][] = rows.map((row) => [
        text(row.code),
        text(row.sector),
        text(row.trade_name),
        text(row.email),
        text(row.status),
        ars(row.price),
        text(row.created_at),
        text(row.updated_at),
        text(row.payment_status),
        text(row.payment_id),
      ]);
      return {
        filename: `reservas-${event.slug}-${today.toISOString().slice(0, 10)}.csv`,
        csv: csvDocument(HEADER, lines),
      };
    });
  }
}

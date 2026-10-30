import type { Observable } from 'rxjs';

/** Read model of `GET /api/v1/events/:id/metrics` (design D2). Money in integer cents. */
export interface EventMetricsDto {
  readonly eventId: string;
  readonly eventName: string;
  readonly venueName: string;
  readonly startsAt: string; // ISO 8601 UTC
  readonly endsAt: string;
  readonly layoutVersionId: string;
  readonly sellableStands: number;
  readonly blockedStands: number;
  readonly assignedStands: number;
  readonly approvedGmvCents: number;
  readonly currency: 'ARS';
  readonly activeReservations: number;
  readonly reconciliationPending: number;
  readonly gmvByMonth: readonly { readonly month: string; readonly cents: number }[]; // 'YYYY-MM'
}

/** Port for event KPIs. Also the DI token: provide an adapter with `{ provide: EventMetricsRepository, ... }`. */
export abstract class EventMetricsRepository {
  abstract get(eventId: string): Observable<EventMetricsDto>;
}

export class EventNotFoundError extends Error {
  constructor(readonly eventId: string) {
    super(`Event ${eventId} not found`);
    this.name = 'EventNotFoundError';
  }
}

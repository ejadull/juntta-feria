import { defer, of, type Observable } from 'rxjs';
import { DEMO_CONTEXT } from '../../../shared/demo-context';
import {
  EventMetricsRepository,
  EventNotFoundError,
  type EventMetricsDto,
} from './event-metrics.repository';

/**
 * Demo KPIs consistent with the demo plan (`demo-v1`: 40 stands) and with themselves:
 * the monthly GMV adds up to the approved GMV. Fictitious amounts.
 */
export const DEMO_EVENT_METRICS: EventMetricsDto = {
  eventId: DEMO_CONTEXT.event.id,
  eventName: DEMO_CONTEXT.event.name,
  venueName: 'Espacio Duam, Neuquén',
  startsAt: '2026-11-20T13:00:00Z',
  endsAt: '2026-11-22T23:00:00Z',
  layoutVersionId: DEMO_CONTEXT.event.layoutVersionId,
  sellableStands: 40,
  blockedStands: 2,
  assignedStands: 23,
  approvedGmvCents: 244_200_000,
  currency: 'ARS',
  activeReservations: 3,
  reconciliationPending: 1,
  gmvByMonth: [
    { month: '2026-05', cents: 12_000_000 },
    { month: '2026-06', cents: 24_000_000 },
    { month: '2026-07', cents: 36_000_000 },
    { month: '2026-08', cents: 52_000_000 },
    { month: '2026-09', cents: 68_000_000 },
    { month: '2026-10', cents: 52_200_000 },
  ],
};

/** Stand-in for REP-01 (`GET /api/v1/events/:id/metrics`). */
export class InMemoryEventMetricsRepository extends EventMetricsRepository {
  private readonly byId: ReadonlyMap<string, EventMetricsDto>;

  constructor(seed: readonly EventMetricsDto[] = [DEMO_EVENT_METRICS]) {
    super();
    this.byId = new Map(seed.map((m) => [m.eventId, m]));
  }

  get(eventId: string): Observable<EventMetricsDto> {
    return defer(() => {
      const metrics = this.byId.get(eventId);
      if (!metrics) throw new EventNotFoundError(eventId);
      return of(metrics);
    });
  }
}

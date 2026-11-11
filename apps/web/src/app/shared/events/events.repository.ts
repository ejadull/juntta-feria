import type { Observable } from 'rxjs';

export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';

/** `GET /events` (EVT-01), only what the organizer screens need to pick "the current event". */
export interface OrganizerEvent {
  readonly id: string;
  readonly name: string;
  readonly status: EventStatus;
  readonly startsAt: string;
  readonly layoutVersionId: string;
}

/** Port for the organization's events. Also the DI token. */
export abstract class EventsRepository {
  abstract list(): Observable<readonly OrganizerEvent[]>;
}

const SELLING: readonly EventStatus[] = ['PUBLISHED', 'ACTIVE'];

/** Most recent event on sale; when none is, the most recent one. `null` without events. */
export function currentEvent(events: readonly OrganizerEvent[]): OrganizerEvent | null {
  const newestFirst = [...events].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return newestFirst.find((e) => SELLING.includes(e.status)) ?? newestFirst[0] ?? null;
}

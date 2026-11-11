import type { Observable } from 'rxjs';
import type { ProblemIssue } from '../../../shared/auth/problem';
import type { EventStatus } from '../../../shared/events/events.repository';

/** An event as `GET /events` and `GET /events/:id` return it (EVT-01). Dates are ISO 8601. */
export interface EventDto {
  readonly id: string;
  readonly venueId: string;
  readonly layoutVersionId: string;
  readonly name: string;
  readonly slug: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly salesOpenAt: string;
  readonly salesCloseAt: string;
  readonly status: EventStatus;
  readonly publishedAt: string | null;
}

export interface CreateEventInput {
  readonly venueId: string;
  readonly layoutVersionId: string;
  readonly name: string;
  /** The API derives it from the name when omitted. */
  readonly slug?: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly salesOpenAt: string;
  readonly salesCloseAt: string;
}

/** Only a draft event changes (409 otherwise); the venue and the plan are fixed at creation. */
export type UpdateEventInput = Partial<Omit<CreateEventInput, 'venueId' | 'layoutVersionId'>>;

/** The 422 of `POST /events/:id/publish`: what keeps the event from going on sale. */
export class EventPublishRejectedError extends Error {
  constructor(readonly issues: readonly ProblemIssue[]) {
    super(`Publish rejected with ${issues.length} issue(s)`);
    this.name = 'EventPublishRejectedError';
  }
}

/**
 * Port for the organizer events. Also the DI token. Failures are the API HTTP errors
 * (409 duplicate slug or not a draft, 404, 400, 409 layout not published), except publish.
 */
export abstract class EventAdminRepository {
  abstract list(): Observable<readonly EventDto[]>;
  abstract get(id: string): Observable<EventDto>;
  abstract create(input: CreateEventInput): Observable<EventDto>;
  abstract update(id: string, patch: UpdateEventInput): Observable<EventDto>;
  /** OWNER and ADMIN only. Fails with EventPublishRejectedError when the API reports issues. */
  abstract publish(id: string): Observable<EventDto>;
}

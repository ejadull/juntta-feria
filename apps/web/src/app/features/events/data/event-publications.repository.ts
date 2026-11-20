import type { Observable } from 'rxjs';

/** A publication of the event as its organizer sees it (MED-11). `url` is a short-lived signed link. */
export interface EventPublicationDto {
  readonly id: string;
  readonly status: 'READY' | 'HIDDEN';
  readonly kind: 'IMAGE' | 'VIDEO';
  readonly caption: string | null;
  readonly durationS: number | null;
  readonly exhibitorName: string;
  readonly url: string;
}

/**
 * Port for the organizer's moderation of an event's publications. Also the DI token. Failures are
 * the API's HTTP errors (409 `NOT_PUBLISHED`, 404, 403).
 */
export abstract class EventPublicationsRepository {
  abstract list(eventId: string): Observable<readonly EventPublicationDto[]>;
  /** Hides (`hidden: true`) or shows (`false`) a publication. */
  abstract setHidden(
    eventId: string,
    id: string,
    hidden: boolean,
  ): Observable<EventPublicationDto>;
}

import { defer, of, throwError, type Observable } from 'rxjs';
import {
  EventPublicationsRepository,
  type EventPublicationDto,
} from './event-publications.repository';

/** Test double: keeps the publications in memory; `failWith` makes the next change fail. */
export class InMemoryEventPublicationsRepository extends EventPublicationsRepository {
  private rows: readonly EventPublicationDto[];
  failWith: unknown = null;

  constructor(seed: readonly EventPublicationDto[] = []) {
    super();
    this.rows = seed;
  }

  hidden(id: string): boolean {
    return this.rows.find((p) => p.id === id)?.status === 'HIDDEN';
  }

  list(): Observable<readonly EventPublicationDto[]> {
    return defer(() => of(this.rows));
  }

  setHidden(_eventId: string, id: string, hidden: boolean): Observable<EventPublicationDto> {
    return defer(() => {
      if (this.failWith) return throwError(() => this.failWith);
      const found = this.rows.find((p) => p.id === id);
      if (!found) return throwError(() => new Error(`Unknown publication ${id}`));
      const updated: EventPublicationDto = { ...found, status: hidden ? 'HIDDEN' : 'READY' };
      this.rows = this.rows.map((p) => (p.id === id ? updated : p));
      return of(updated);
    });
  }
}

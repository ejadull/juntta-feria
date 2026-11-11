import { defer, of, throwError, type Observable } from 'rxjs';
import type { ProblemIssue } from '../../../shared/auth/problem';
import { httpError } from '../../../shared/http-error';
import { fold } from '../../../shared/text';
import {
  EventAdminRepository,
  EventPublishRejectedError,
  type CreateEventInput,
  type EventDto,
  type UpdateEventInput,
} from './event-admin.repository';

const slugify = (text: string): string =>
  fold(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'evento';

/**
 * Test double with the API rules: unique slug, only a draft changes, and publish fails with
 * whatever `issuesFor` reports (the stand rules live in the API).
 */
export class InMemoryEventAdminRepository extends EventAdminRepository {
  private rows: EventDto[];
  private next = 1;

  constructor(
    seed: readonly EventDto[] = [],
    private readonly issuesFor: (eventId: string) => readonly ProblemIssue[] = () => [],
  ) {
    super();
    this.rows = [...seed];
  }

  list(): Observable<readonly EventDto[]> {
    return defer(() => of([...this.rows]));
  }

  get(id: string): Observable<EventDto> {
    return defer(() => {
      const event = this.rows.find((e) => e.id === id);
      return event ? of(event) : throwError(() => httpError(404));
    });
  }

  create(input: CreateEventInput): Observable<EventDto> {
    return defer(() => {
      const slug = input.slug ?? slugify(input.name);
      if (this.rows.some((e) => e.slug === slug)) return throwError(() => httpError(409));
      const event: EventDto = {
        ...input,
        slug,
        id: `event-${this.next++}`,
        status: 'DRAFT',
        publishedAt: null,
      };
      this.rows = [event, ...this.rows];
      return of(event);
    });
  }

  update(id: string, patch: UpdateEventInput): Observable<EventDto> {
    return defer(() => {
      const before = this.rows.find((e) => e.id === id);
      if (!before) return throwError(() => httpError(404));
      if (before.status !== 'DRAFT') return throwError(() => httpError(409));
      if (patch.slug && this.rows.some((e) => e.id !== id && e.slug === patch.slug))
        return throwError(() => httpError(409));
      const after = { ...before, ...patch };
      this.rows = this.rows.map((e) => (e.id === id ? after : e));
      return of(after);
    });
  }

  publish(id: string): Observable<EventDto> {
    return defer(() => {
      const before = this.rows.find((e) => e.id === id);
      if (!before) return throwError(() => httpError(404));
      if (before.status !== 'DRAFT') return throwError(() => httpError(409));
      const issues = this.issuesFor(id);
      if (issues.length > 0) return throwError(() => new EventPublishRejectedError(issues));
      const after: EventDto = {
        ...before,
        status: 'PUBLISHED',
        publishedAt: new Date().toISOString(),
      };
      this.rows = this.rows.map((e) => (e.id === id ? after : e));
      return of(after);
    });
  }
}

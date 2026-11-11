import { defer, of, throwError, type Observable } from 'rxjs';
import { httpError } from '../../../shared/http-error';
import { VenueRepository, type VenueDto, type VenueInput } from './venue.repository';

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Test double with the API's rules: unique name (any case) and a venue in use cannot be removed. */
export class InMemoryVenueRepository extends VenueRepository {
  private rows: VenueDto[];
  private next = 1;

  constructor(
    seed: readonly VenueDto[] = [],
    private readonly inUse: ReadonlySet<string> = new Set(),
  ) {
    super();
    this.rows = [...seed];
  }

  list(): Observable<readonly VenueDto[]> {
    return defer(() => of([...this.rows]));
  }

  create(input: VenueInput): Observable<VenueDto> {
    return defer(() => {
      if (this.rows.some((v) => sameName(v.name, input.name)))
        return throwError(() => httpError(409));
      const venue: VenueDto = { id: `venue-${this.next++}`, ...input };
      this.rows = [...this.rows, venue];
      return of(venue);
    });
  }

  update(id: string, input: VenueInput): Observable<VenueDto> {
    return defer(() => {
      if (!this.rows.some((v) => v.id === id)) return throwError(() => httpError(404));
      if (this.rows.some((v) => v.id !== id && sameName(v.name, input.name)))
        return throwError(() => httpError(409));
      const venue: VenueDto = { id, ...input };
      this.rows = this.rows.map((v) => (v.id === id ? venue : v));
      return of(venue);
    });
  }

  remove(id: string): Observable<void> {
    return defer(() => {
      if (!this.rows.some((v) => v.id === id)) return throwError(() => httpError(404));
      if (this.inUse.has(id)) return throwError(() => httpError(409));
      this.rows = this.rows.filter((v) => v.id !== id);
      return of(undefined);
    });
  }
}

import { defer, of, throwError, type Observable } from 'rxjs';
import { httpError } from '../../../shared/http-error';
import {
  EventInventoryRepository,
  type SectorDto,
  type SectorInput,
  type StandChange,
  type StandDto,
} from './event-inventory.repository';

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Test double with the API rules: unique sector name, an assigned stand keeps its status, a stand
 * update is all or nothing, and removing a sector leaves its stands without one.
 */
export class InMemoryEventInventoryRepository extends EventInventoryRepository {
  private sectors: SectorDto[];
  private stands: StandDto[];
  private next = 1;
  /** Every stand update received, to assert how a save was grouped. */
  readonly updates: StandChange[] = [];

  constructor(stands: readonly StandDto[] = [], sectors: readonly SectorDto[] = []) {
    super();
    this.stands = [...stands];
    this.sectors = [...sectors];
  }

  listSectors(): Observable<readonly SectorDto[]> {
    return defer(() => of([...this.sectors].sort((a, b) => a.sortOrder - b.sortOrder)));
  }

  createSector(_eventId: string, input: SectorInput): Observable<SectorDto> {
    return defer(() => {
      if (this.sectors.some((s) => sameName(s.name, input.name)))
        return throwError(() => httpError(409));
      const sector: SectorDto = {
        id: `sector-${this.next++}`,
        name: input.name,
        sortOrder: input.sortOrder ?? 0,
      };
      this.sectors = [...this.sectors, sector];
      return of(sector);
    });
  }

  updateSector(
    _eventId: string,
    sectorId: string,
    patch: Partial<SectorInput>,
  ): Observable<SectorDto> {
    return defer(() => {
      const before = this.sectors.find((s) => s.id === sectorId);
      if (!before) return throwError(() => httpError(404));
      const name = patch.name;
      if (name && this.sectors.some((s) => s.id !== sectorId && sameName(s.name, name)))
        return throwError(() => httpError(409));
      const after = { ...before, ...patch };
      this.sectors = this.sectors.map((s) => (s.id === sectorId ? after : s));
      return of(after);
    });
  }

  removeSector(_eventId: string, sectorId: string): Observable<void> {
    return defer(() => {
      if (!this.sectors.some((s) => s.id === sectorId)) return throwError(() => httpError(404));
      this.sectors = this.sectors.filter((s) => s.id !== sectorId);
      this.stands = this.stands.map((s) =>
        s.sectorId === sectorId ? { ...s, sectorId: null } : s,
      );
      return of(undefined);
    });
  }

  listStands(): Observable<readonly StandDto[]> {
    return defer(() => of([...this.stands]));
  }

  updateStands(_eventId: string, change: StandChange): Observable<readonly StandDto[]> {
    return defer(() => {
      this.updates.push(change);
      const targets = this.stands.filter((s) => change.standIds.includes(s.id));
      if (targets.length !== change.standIds.length) return throwError(() => httpError(400));
      if (change.status && targets.some((s) => s.status === 'ASSIGNED'))
        return throwError(() => httpError(409));
      if (change.sectorId && !this.sectors.some((s) => s.id === change.sectorId))
        return throwError(() => httpError(400));
      const apply = (s: StandDto): StandDto => ({
        ...s,
        ...(change.priceCents !== undefined && { priceCents: change.priceCents, hasPrice: true }),
        ...(change.sectorId !== undefined && { sectorId: change.sectorId }),
        ...(change.status !== undefined && { status: change.status }),
      });
      this.stands = this.stands.map((s) => (change.standIds.includes(s.id) ? apply(s) : s));
      return of(this.stands.filter((s) => change.standIds.includes(s.id)));
    });
  }
}

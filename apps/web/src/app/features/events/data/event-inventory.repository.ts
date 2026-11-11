import type { Observable } from 'rxjs';

export type StandStatus = 'AVAILABLE' | 'BLOCKED' | 'DISABLED' | 'ASSIGNED';

/** What the organizer may set on a stand; ASSIGNED only comes from a confirmed reservation. */
export type EditableStandStatus = Exclude<StandStatus, 'ASSIGNED'>;

export interface SectorDto {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
}

/** `GET /events/:id/stands`: `priceCents` is 0 and `hasPrice` false while there is no tariff. */
export interface StandDto {
  readonly id: string;
  readonly layoutObjectId: string;
  readonly code: string;
  readonly sectorId: string | null;
  readonly status: StandStatus;
  readonly priceCents: number;
  readonly hasPrice: boolean;
  readonly currency: string;
}

export interface SectorInput {
  readonly name: string;
  readonly sortOrder?: number;
}

/** One bulk change: the same price, sector (null clears it) and/or status for every stand listed. */
export interface StandChange {
  readonly standIds: readonly string[];
  readonly priceCents?: number;
  readonly sectorId?: string | null;
  readonly status?: EditableStandStatus;
}

/**
 * Port for the sectors and priced stands of an event (ADR 0002). Also the DI token. Failures are
 * the API HTTP errors (409 duplicate sector or assigned stand, 400 foreign stand or sector, 404).
 */
export abstract class EventInventoryRepository {
  abstract listSectors(eventId: string): Observable<readonly SectorDto[]>;
  abstract createSector(eventId: string, input: SectorInput): Observable<SectorDto>;
  abstract updateSector(
    eventId: string,
    sectorId: string,
    patch: Partial<SectorInput>,
  ): Observable<SectorDto>;
  abstract removeSector(eventId: string, sectorId: string): Observable<void>;
  abstract listStands(eventId: string): Observable<readonly StandDto[]>;
  /** `PATCH /events/:id/stands`: answers the stands it changed. */
  abstract updateStands(eventId: string, change: StandChange): Observable<readonly StandDto[]>;
}

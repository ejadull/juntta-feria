import type { Observable } from 'rxjs';

export type VenueType = 'FIXED' | 'TEMPORARY';

/** `GET /venues` (VEN-01). Sizes are meters with at most two decimals. */
export interface VenueDto {
  readonly id: string;
  readonly type: VenueType;
  readonly name: string;
  readonly address: string | null;
  readonly timezone: string;
  readonly widthM: number;
  readonly heightM: number;
}

export type VenueInput = Omit<VenueDto, 'id'>;

/**
 * Port for the organization's venues. Also the DI token. Failures are the API's HTTP errors
 * (409 duplicate name or venue in use, 404, 400); the pages turn them into Spanish messages.
 */
export abstract class VenueRepository {
  abstract list(): Observable<readonly VenueDto[]>;
  abstract create(input: VenueInput): Observable<VenueDto>;
  abstract update(id: string, input: VenueInput): Observable<VenueDto>;
  /** OWNER and ADMIN only (409 while a layout template or an event uses it). */
  abstract remove(id: string): Observable<void>;
}

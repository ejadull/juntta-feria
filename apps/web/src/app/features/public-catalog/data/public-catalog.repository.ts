import type { Observable } from 'rxjs';
import type { LayoutObjectKind, PolygonGeometry } from '../../layout-editor/domain/layout.types';

/** Public, sanitized stand states (design D2 of pub-ui-catalog; tokens from UX-01). */
export type PublicStandStatus = 'AVAILABLE' | 'RESERVED' | 'OCCUPIED' | 'BLOCKED';

export const STATUS_LABEL: Readonly<Record<PublicStandStatus, string>> = {
  AVAILABLE: 'Disponible',
  RESERVED: 'Reservado',
  OCCUPIED: 'Ocupado',
  BLOCKED: 'Bloqueado',
};

/** `GET /api/v1/public/events` item. Dates in ISO 8601 UTC. */
export interface PublicEventSummaryDto {
  readonly slug: string;
  readonly name: string;
  readonly organizerName: string;
  readonly venueName: string;
  readonly venueAddress: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly salesOpen: boolean;
  readonly availableStands: number;
  readonly totalStands: number;
}

export interface StandProperties {
  readonly kind: 'STAND';
  readonly standId: string;
  readonly code: string;
  readonly areaM2: number;
  readonly status: PublicStandStatus;
  readonly sector: string | null;
  readonly price: { readonly currency: 'ARS'; readonly valueCents: number };
  /** Only exhibitors who consented to a public profile (AC-11). */
  readonly exhibitor: {
    readonly name: string;
    readonly category: string;
    /** Same consent as the name; null when the exhibitor wrote none. */
    readonly description: string | null;
    /** Stand photos in display order; only present under the same consent. Empty when none. */
    readonly photos: readonly StandPhoto[];
  } | null;
}

/** `url` is a short-lived signed link: never cache it beyond the page. */
export interface StandPhoto {
  readonly url: string;
  readonly alt: string;
}

export interface AreaProperties {
  readonly kind: Exclude<LayoutObjectKind, 'STAND'>;
  readonly label: string | null;
}

export interface MapFeature {
  readonly type: 'Feature';
  readonly geometry: PolygonGeometry;
  readonly properties: StandProperties | AreaProperties;
}

/** `GET /api/v1/public/events/:slug/map` — extends the example in spec §5.3. */
export interface PublicMapDto {
  readonly slug: string;
  readonly layoutVersion: number;
  readonly units: 'm';
  readonly bounds: { readonly width: number; readonly height: number };
  readonly features: readonly MapFeature[];
}

/** `GET /api/v1/public/events/:slug/exhibitors` — consented public profiles only (INV-08). */
export interface PublicExhibitorDto {
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly standCode: string | null;
}

/** Port for public, unauthenticated reads. Also the DI token. */
export abstract class PublicCatalogRepository {
  abstract listEvents(): Observable<readonly PublicEventSummaryDto[]>;
  abstract getMap(slug: string): Observable<PublicMapDto>;
  abstract listExhibitors(slug: string): Observable<readonly PublicExhibitorDto[]>;
}

export class PublicEventNotFoundError extends Error {
  constructor(readonly slug: string) {
    super(`Public event ${slug} not found`);
    this.name = 'PublicEventNotFoundError';
  }
}

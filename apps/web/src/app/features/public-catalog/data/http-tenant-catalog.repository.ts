import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, forkJoin, map, of, switchMap, throwError, type Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import type { LayoutVersionDto } from '../../layout-editor/domain/layout.types';
import {
  PublicCatalogRepository,
  PublicEventNotFoundError,
  type PublicEventSummaryDto,
  type PublicExhibitorDto,
  type PublicMapDto,
} from './public-catalog.repository';
import { toPublicMap, type ApiEventSector, type ApiEventStand } from './tenant-catalog.mapper';

/** `GET /events` item (EVT-01), as an exhibitor sees it: only events on sale. */
interface ApiEvent {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly layoutVersionId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly salesOpenAt: string;
  readonly salesCloseAt: string;
}

interface ApiReservation {
  readonly status: string;
  readonly stand: { readonly id: string };
}

const LIVE = new Set(['HELD', 'PAYMENT_PENDING', 'CONFIRMED']);

/**
 * Real data for the exhibitor's "Explorar stands" while the public portal (PUB-01) does not exist:
 * the events, stands and plan of the exhibitor's organization (the interceptor adds the tenant).
 * Visitors keep the in-memory catalog.
 */
@Injectable()
export class HttpTenantCatalogRepository extends PublicCatalogRepository {
  private readonly http = inject(HttpClient);

  listEvents(): Observable<readonly PublicEventSummaryDto[]> {
    return this.http.get<readonly ApiEvent[]>(`${API_BASE}/events`).pipe(
      map((events) =>
        events.map((e) => ({
          slug: e.slug,
          name: e.name,
          city: '',
          province: '',
          venueName: '',
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          description: '',
          salesOpen:
            Date.parse(e.salesOpenAt) <= Date.now() && Date.now() <= Date.parse(e.salesCloseAt),
          availableStands: 0,
          totalStands: 0,
          hasPublicMap: true,
        })),
      ),
    );
  }

  getMap(slug: string): Observable<PublicMapDto> {
    return this.http.get<readonly ApiEvent[]>(`${API_BASE}/events`).pipe(
      map((events) => events.find((e) => e.slug === slug)),
      switchMap((event) => {
        if (!event) return throwError(() => new PublicEventNotFoundError(slug));
        const base = `${API_BASE}/events/${event.id}`;
        return forkJoin({
          layout: this.http.get<LayoutVersionDto>(
            `${API_BASE}/layout-versions/${event.layoutVersionId}`,
          ),
          stands: this.http.get<readonly ApiEventStand[]>(`${base}/stands`),
          sectors: this.http.get<readonly ApiEventSector[]>(`${base}/sectors`),
          own: this.http
            .get<readonly ApiReservation[]>(`${API_BASE}/reservations`, {
              params: { eventId: event.id },
            })
            .pipe(catchError(() => of<readonly ApiReservation[]>([]))),
        }).pipe(
          map(({ layout, stands, sectors, own }) =>
            toPublicMap({
              slug,
              layout,
              stands,
              sectors,
              ownStandIds: new Set(own.filter((r) => LIVE.has(r.status)).map((r) => r.stand.id)),
            }),
          ),
        );
      }),
    );
  }

  /** Not part of the exhibitor's flow; the directory belongs to the public portal. */
  listExhibitors(): Observable<readonly PublicExhibitorDto[]> {
    return of([]);
  }
}

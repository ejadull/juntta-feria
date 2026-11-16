import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, throwError, type Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import { problemOf } from '../../../shared/auth/problem';
import { KIND_LABEL } from '../../layout-editor/domain/validation';
import {
  PublicCatalogRepository,
  PublicEventNotFoundError,
  type PublicEventSummaryDto,
  type PublicExhibitorDto,
  type PublicMapDto,
} from './public-catalog.repository';

const PUBLIC = `${API_BASE}/public/events`;

/**
 * PUB-01 through the API: anonymous reads. The interceptor adds no tenant to `/public/` and
 * no bearer token unless a session exists (harmless: the API ignores it there).
 */
@Injectable()
export class HttpPublicCatalogRepository extends PublicCatalogRepository {
  private readonly http = inject(HttpClient);

  listEvents(): Observable<readonly PublicEventSummaryDto[]> {
    return this.http.get<readonly PublicEventSummaryDto[]>(PUBLIC);
  }

  getMap(slug: string): Observable<PublicMapDto> {
    return this.http.get<PublicMapDto>(`${PUBLIC}/${encodeURIComponent(slug)}/map`).pipe(
      map((dto) => ({
        ...dto,
        // Areas come without a label: name them by kind, as the editor does.
        features: dto.features.map((f) =>
          f.properties.kind === 'STAND'
            ? {
                ...f,
                properties: {
                  ...f.properties,
                  exhibitor: f.properties.exhibitor
                    ? { ...f.properties.exhibitor, photos: f.properties.exhibitor.photos ?? [] }
                    : null,
                },
              }
            : {
                ...f,
                properties: {
                  ...f.properties,
                  label: f.properties.label ?? KIND_LABEL[f.properties.kind],
                },
              },
        ),
      })),
      catchError((error: unknown) => throwError(() => this.mapped(error, slug))),
    );
  }

  listExhibitors(slug: string): Observable<readonly PublicExhibitorDto[]> {
    return this.http
      .get<readonly PublicExhibitorDto[]>(`${PUBLIC}/${encodeURIComponent(slug)}/exhibitors`)
      .pipe(catchError((error: unknown) => throwError(() => this.mapped(error, slug))));
  }

  private mapped(error: unknown, slug: string): unknown {
    return problemOf(error).status === 404 ? new PublicEventNotFoundError(slug) : error;
  }
}

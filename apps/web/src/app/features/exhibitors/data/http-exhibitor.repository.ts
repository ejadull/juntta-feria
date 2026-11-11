import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import { ExhibitorRepository, type ExhibitorSummaryDto } from './exhibitor.repository';

/** Organizer's exhibitor list through the API (managers only; extra API fields are ignored). */
@Injectable()
export class HttpExhibitorRepository extends ExhibitorRepository {
  private readonly http = inject(HttpClient);

  list(): Observable<readonly ExhibitorSummaryDto[]> {
    return this.http.get<readonly ExhibitorSummaryDto[]>(`${API_BASE}/exhibitors`);
  }
}

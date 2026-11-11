import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import type { LayoutVersionDto } from '../domain/layout.types';
import {
  LayoutTemplatesRepository,
  type CreateLayoutTemplateInput,
  type LayoutTemplateDto,
} from './layout-templates.repository';

/** LAY-01 templates through the API (tenant and token come from the interceptor). */
@Injectable()
export class HttpLayoutTemplatesRepository extends LayoutTemplatesRepository {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/layout-templates`;

  list(): Observable<readonly LayoutTemplateDto[]> {
    return this.http.get<readonly LayoutTemplateDto[]>(this.url);
  }

  create(input: CreateLayoutTemplateInput): Observable<LayoutVersionDto> {
    return this.http.post<LayoutVersionDto>(this.url, input);
  }
}

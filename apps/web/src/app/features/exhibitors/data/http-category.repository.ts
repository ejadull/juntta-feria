import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import { CategoryRepository, type CategoryDto } from './category.repository';

/** EXH-02 through the API (tenant and token come from the interceptor). */
@Injectable()
export class HttpCategoryRepository extends CategoryRepository {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/exhibitor-categories`;

  list(): Observable<readonly CategoryDto[]> {
    return this.http.get<readonly CategoryDto[]>(this.url);
  }

  create(name: string): Observable<CategoryDto> {
    return this.http.post<CategoryDto>(this.url, { name });
  }

  rename(id: string, name: string): Observable<CategoryDto> {
    return this.http.patch<CategoryDto>(`${this.url}/${encodeURIComponent(id)}`, { name });
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`);
  }
}

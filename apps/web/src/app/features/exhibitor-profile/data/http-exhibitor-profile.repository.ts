import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, of, throwError, type Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import {
  ExhibitorProfileRepository,
  type ExhibitorProfileDto,
  type ExhibitorProfileInput,
} from './exhibitor-profile.repository';

/** EXH-01 through the API: the exhibitor's own profile (extra API fields are ignored). */
@Injectable()
export class HttpExhibitorProfileRepository extends ExhibitorProfileRepository {
  private readonly http = inject(HttpClient);
  private readonly url = `${API_BASE}/me/exhibitor-profile`;

  get(): Observable<ExhibitorProfileDto | null> {
    return this.http
      .get<ExhibitorProfileDto>(this.url)
      .pipe(
        catchError((error: unknown) =>
          error instanceof HttpErrorResponse && error.status === 404
            ? of(null)
            : throwError(() => error),
        ),
      );
  }

  save(input: ExhibitorProfileInput): Observable<ExhibitorProfileDto> {
    return this.http.put<ExhibitorProfileDto>(this.url, input);
  }
}

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, throwError, type Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import { problemOf } from '../../../shared/auth/problem';
import type { LayoutVersionDto } from '../domain/layout.types';
import type { ValidationIssue } from '../domain/validation';
import {
  LayoutNotEditableError,
  LayoutNotFoundError,
  LayoutRepository,
  PublishRejectedError,
} from './layout.repository';

const VERSIONS = `${API_BASE}/layout-versions`;

/** Issue as the API reports it (`issues` of the 422 problem); the editor adds the severity. */
interface ApiIssue {
  readonly code: ValidationIssue['code'];
  readonly objectIds: readonly string[];
  readonly message: string;
}

const issuesOf = (error: unknown): readonly ValidationIssue[] => {
  const issues = (error as { error?: { issues?: unknown } } | null)?.error?.issues;
  return Array.isArray(issues)
    ? (issues as readonly ApiIssue[]).map((i) => ({ ...i, severity: 'error' as const }))
    : [];
};

/** LAY-01 through the API (tenant and token come from the interceptor). */
@Injectable()
export class HttpLayoutRepository extends LayoutRepository {
  private readonly http = inject(HttpClient);

  get(versionId: string): Observable<LayoutVersionDto> {
    return this.http
      .get<LayoutVersionDto>(`${VERSIONS}/${encodeURIComponent(versionId)}`)
      .pipe(catchError((error: unknown) => throwError(() => this.mapped(error, versionId))));
  }

  saveDraft(version: LayoutVersionDto): Observable<LayoutVersionDto> {
    return this.http
      .put<LayoutVersionDto>(`${VERSIONS}/${encodeURIComponent(version.id)}/objects`, {
        objects: version.objects,
      })
      .pipe(catchError((error: unknown) => throwError(() => this.mapped(error, version.id))));
  }

  publish(versionId: string): Observable<LayoutVersionDto> {
    return this.http
      .post<LayoutVersionDto>(`${VERSIONS}/${encodeURIComponent(versionId)}/publish`, {})
      .pipe(
        catchError((error: unknown) => {
          const issues = problemOf(error).status === 422 ? issuesOf(error) : [];
          return throwError(() =>
            issues.length > 0 ? new PublishRejectedError(issues) : this.mapped(error, versionId),
          );
        }),
      );
  }

  cloneAsDraft(source: Pick<LayoutVersionDto, 'id' | 'templateId'>): Observable<LayoutVersionDto> {
    return this.http
      .post<LayoutVersionDto>(
        `${API_BASE}/layout-templates/${encodeURIComponent(source.templateId)}/versions`,
        { sourceVersionId: source.id },
      )
      .pipe(catchError((error: unknown) => throwError(() => this.mapped(error, source.id))));
  }

  /** 404 → not found, 409 → not a draft; anything else stays the HTTP error. */
  private mapped(error: unknown, versionId: string): unknown {
    const { status } = problemOf(error);
    if (status === 404) return new LayoutNotFoundError(versionId);
    if (status === 409) return new LayoutNotEditableError(versionId);
    return error;
  }
}

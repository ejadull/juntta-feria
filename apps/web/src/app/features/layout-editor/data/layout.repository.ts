import type { Observable } from 'rxjs';
import type { LayoutVersionDto } from '../domain/layout.types';
import type { ValidationIssue } from '../domain/validation';

/** Port for layout persistence. Also the DI token: provide an adapter with `{ provide: LayoutRepository, ... }`. */
export abstract class LayoutRepository {
  abstract get(versionId: string): Observable<LayoutVersionDto>;
  /** Persists objects of a DRAFT. Status and version number are owned by the server. */
  abstract saveDraft(version: LayoutVersionDto): Observable<LayoutVersionDto>;
  /** Fails with PublishRejectedError when the server-side validation finds issues. */
  abstract publish(versionId: string): Observable<LayoutVersionDto>;
  /** Creates the next DRAFT version of the same template from `versionId`. */
  abstract cloneAsDraft(versionId: string): Observable<LayoutVersionDto>;
}

export class LayoutNotFoundError extends Error {
  constructor(readonly versionId: string) {
    super(`Layout version ${versionId} not found`);
    this.name = 'LayoutNotFoundError';
  }
}

export class LayoutNotEditableError extends Error {
  constructor(readonly versionId: string) {
    super(`Layout version ${versionId} is not a draft`);
    this.name = 'LayoutNotEditableError';
  }
}

export class PublishRejectedError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(`Publish rejected with ${issues.length} issue(s)`);
    this.name = 'PublishRejectedError';
  }
}

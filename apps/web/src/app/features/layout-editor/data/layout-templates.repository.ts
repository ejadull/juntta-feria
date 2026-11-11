import type { Observable } from 'rxjs';
import type { LayoutVersionDto, LayoutVersionStatus } from '../domain/layout.types';

/** One entry of `GET /layout-templates` (LAY-01): a plan and the status of each version. */
export interface LayoutTemplateDto {
  readonly id: string;
  readonly name: string;
  readonly venueId: string | null;
  readonly versions: readonly {
    readonly id: string;
    readonly version: number;
    readonly status: LayoutVersionStatus;
    readonly publishedAt: string | null;
  }[];
}

export interface CreateLayoutTemplateInput {
  readonly name: string;
  readonly venueId: string;
}

/**
 * Port for the organization's plans (templates). Also the DI token. A new template comes with its
 * first draft, which is what the editor opens. Failures are the API's HTTP errors (409 duplicate
 * name, 404 venue).
 */
export abstract class LayoutTemplatesRepository {
  abstract list(): Observable<readonly LayoutTemplateDto[]>;
  abstract create(input: CreateLayoutTemplateInput): Observable<LayoutVersionDto>;
}

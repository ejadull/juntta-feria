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

export interface CloneLayoutTemplateInput {
  readonly name: string;
  /** Any version (draft, published or archived) of the template being cloned. */
  readonly sourceVersionId: string;
  /** Another venue of the organization; the source's venue when omitted. */
  readonly venueId?: string;
}

/**
 * Port for the organization's plans (templates). Also the DI token. A new template comes with its
 * first draft, which is what the editor opens. Failures are the API's HTTP errors (409 duplicate
 * name, 404 venue).
 */
export abstract class LayoutTemplatesRepository {
  abstract list(): Observable<readonly LayoutTemplateDto[]>;
  abstract create(input: CreateLayoutTemplateInput): Observable<LayoutVersionDto>;
  /** "Clonar plano": a NEW template whose first version is a draft copy; the source is untouched. */
  abstract clone(templateId: string, input: CloneLayoutTemplateInput): Observable<LayoutVersionDto>;
}

import { defer, of, throwError, type Observable } from 'rxjs';
import { httpError } from '../../../shared/http-error';
import type { LayoutVersionDto } from '../domain/layout.types';
import {
  LayoutTemplatesRepository,
  type CreateLayoutTemplateInput,
  type LayoutTemplateDto,
} from './layout-templates.repository';

/** Test double with the API's rules: unique name (any case); a template starts with one draft. */
export class InMemoryLayoutTemplatesRepository extends LayoutTemplatesRepository {
  private rows: LayoutTemplateDto[];
  private next = 1;

  constructor(seed: readonly LayoutTemplateDto[] = []) {
    super();
    this.rows = [...seed];
  }

  list(): Observable<readonly LayoutTemplateDto[]> {
    return defer(() => of([...this.rows]));
  }

  create(input: CreateLayoutTemplateInput): Observable<LayoutVersionDto> {
    return defer(() => {
      if (this.rows.some((t) => t.name.toLowerCase() === input.name.toLowerCase()))
        return throwError(() => httpError(409));
      const n = this.next++;
      const draft: LayoutVersionDto = {
        id: `draft-${n}`,
        templateId: `template-${n}`,
        version: 1,
        status: 'DRAFT',
        widthM: 20,
        heightM: 10,
        objects: [],
      };
      this.rows = [
        ...this.rows,
        {
          id: draft.templateId,
          name: input.name,
          venueId: input.venueId,
          versions: [{ id: draft.id, version: 1, status: 'DRAFT', publishedAt: null }],
        },
      ];
      return of(draft);
    });
  }
}

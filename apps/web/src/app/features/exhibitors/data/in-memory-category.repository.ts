import { defer, of, throwError, type Observable } from 'rxjs';
import { httpError } from '../../../shared/http-error';
import { CategoryRepository, type CategoryDto } from './category.repository';

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** Test double with the API's rules: unique name (any case) and a rubro in use cannot be removed. */
export class InMemoryCategoryRepository extends CategoryRepository {
  private rows: CategoryDto[];
  private next = 1;

  constructor(seed: readonly CategoryDto[] = []) {
    super();
    this.rows = [...seed];
  }

  list(): Observable<readonly CategoryDto[]> {
    return defer(() => of([...this.rows].sort((a, b) => a.name.localeCompare(b.name, 'es'))));
  }

  create(name: string): Observable<CategoryDto> {
    return defer(() => {
      if (this.rows.some((c) => sameName(c.name, name)))
        return throwError(() => httpError(409, { code: 'CATEGORY_EXISTS' }));
      const created: CategoryDto = {
        id: `cat-${this.next++}`,
        name: name.trim(),
        exhibitorCount: 0,
      };
      this.rows = [...this.rows, created];
      return of(created);
    });
  }

  rename(id: string, name: string): Observable<CategoryDto> {
    return defer(() => {
      const current = this.rows.find((c) => c.id === id);
      if (!current) return throwError(() => httpError(404));
      if (this.rows.some((c) => c.id !== id && sameName(c.name, name)))
        return throwError(() => httpError(409, { code: 'CATEGORY_EXISTS' }));
      const renamed = { ...current, name: name.trim() };
      this.rows = this.rows.map((c) => (c.id === id ? renamed : c));
      return of(renamed);
    });
  }

  remove(id: string): Observable<void> {
    return defer(() => {
      const current = this.rows.find((c) => c.id === id);
      if (!current) return throwError(() => httpError(404));
      if (current.exhibitorCount > 0)
        return throwError(() => httpError(409, { code: 'CATEGORY_IN_USE' }));
      this.rows = this.rows.filter((c) => c.id !== id);
      return of(undefined);
    });
  }
}

import type { Observable } from 'rxjs';

/** `GET /exhibitor-categories` (EXH-02): a rubro of the organization and how many exhibitors use it. */
export interface CategoryDto {
  readonly id: string;
  readonly name: string;
  readonly exhibitorCount: number;
}

/**
 * Port for the organization's rubros. Also the DI token. Failures are the API's HTTP errors:
 * 409 `CATEGORY_EXISTS` on a repeated name, 409 `CATEGORY_IN_USE` when removing a used rubro.
 */
export abstract class CategoryRepository {
  abstract list(): Observable<readonly CategoryDto[]>;
  abstract create(name: string): Observable<CategoryDto>;
  abstract rename(id: string, name: string): Observable<CategoryDto>;
  abstract remove(id: string): Observable<void>;
}

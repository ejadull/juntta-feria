import { catchError, map, of, type OperatorFunction } from 'rxjs';

/** Async read state for templates: `null` while loading. */
export type Loaded<T> = { readonly data: T } | { readonly error: string } | null;

/** Wraps a read into `{ data }` or a user-facing `{ error }`, so the stream never errors. */
export const toLoaded =
  <T>(errorMessage: string): OperatorFunction<T, Loaded<T>> =>
  (source) =>
    source.pipe(
      map((data) => ({ data })),
      catchError(() => of({ error: errorMessage })),
    );

export const dataOf = <T>(state: Loaded<T>): T | null =>
  state && 'data' in state ? state.data : null;
export const errorOf = (state: Loaded<unknown>): string | null =>
  state && 'error' in state ? state.error : null;

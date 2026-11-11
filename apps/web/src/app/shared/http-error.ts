import { HttpErrorResponse } from '@angular/common/http';

/** What the HTTP adapters fail with, for the in-memory adapters to fail the same way. */
export const httpError = (status: number, error: unknown = null): HttpErrorResponse =>
  new HttpErrorResponse({ status, error });

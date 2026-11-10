import { HttpErrorResponse } from '@angular/common/http';

/** What the UI needs from an RFC 9457 problem+json answer (`code` is our §5 extension). */
export interface Problem {
  /** 0 when the request never got an answer (offline, proxy down). */
  readonly status: number;
  readonly code: string | null;
}

export function problemOf(error: unknown): Problem {
  if (!(error instanceof HttpErrorResponse)) return { status: 0, code: null };
  const code = (error.error as { code?: unknown } | null)?.code;
  return { status: error.status, code: typeof code === 'string' ? code : null };
}

/** Message for a problem: by `code`, then by HTTP status, then the fallback. */
export function messageFor(
  error: unknown,
  byCode: Readonly<Record<string, string>>,
  byStatus: Readonly<Record<number, string>>,
  fallback: string,
): string {
  const { status, code } = problemOf(error);
  return (code && byCode[code]) || byStatus[status] || fallback;
}

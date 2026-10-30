import { randomUUID } from 'node:crypto';

export const CORRELATION_HEADER = 'x-correlation-id';

/** Restricted charset and length so a client value can never forge log lines or bloat headers. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Reuses the caller's correlation id when it is safe, otherwise generates a UUID v4. */
export function correlationIdFrom(
  header: string | string[] | undefined,
): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && SAFE_ID.test(value) ? value : randomUUID();
}

import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates a request body against a Zod schema. The 400 names the invalid fields but never
 * echoes the received values (they may be personal data or secrets).
 */
export function parseBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
  subject: string,
): z.infer<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const fields = [
    ...new Set(result.error.issues.map((i) => i.path.join('.') || 'body')),
  ];
  throw new BadRequestException(`Invalid ${subject}: ${fields.join(', ')}.`);
}

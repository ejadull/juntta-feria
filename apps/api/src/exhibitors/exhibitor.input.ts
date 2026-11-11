import { z } from 'zod';
import { normalizeCuit } from './cuit.js';

/** Optional CUIT; stored as its 11 digits once the AFIP check digit is valid. */
const taxId = z
  .string()
  .max(20)
  .nullable()
  .optional()
  .transform((value, ctx) => {
    if (value === null || value === undefined) return null;
    const digits = normalizeCuit(value);
    if (!digits) {
      ctx.addIssue({ code: 'custom', message: 'must be a valid CUIT' });
      return z.NEVER;
    }
    return digits;
  });

/**
 * The whole profile as the exhibitor saves it (PUT). Unknown fields (userId, tenantId) are
 * rejected: the owner and the organization come from the session, never from the body.
 */
export const exhibitorProfileInput = z.strictObject({
  legalName: z.string().trim().min(1).max(200),
  tradeName: z.string().trim().min(1).max(120),
  taxId,
  /** A rubro of the same organization (EXH-02); checked against the tenant on save. */
  categoryId: z.uuid(),
  description: z.string().trim().max(2000).default(''),
  /** Consent to appear in the public directory of the organization's events (AC-11). */
  publicContactOptIn: z.boolean(),
});

export type ExhibitorProfileInput = z.infer<typeof exhibitorProfileInput>;

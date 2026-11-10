import { z } from 'zod';

/** `POST /me/subscription` (EXH-05). The payer email defaults to the account's. */
export const startSubscriptionInput = z.object({
  /**
   * Mercado Pago rejects the charge unless the paying account has this email, and in sandbox
   * that is the test buyer's, which differs from the Juntta account's.
   */
  payerEmail: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email())
    .transform((email) => email.toLowerCase())
    .optional(),
});

export type StartSubscriptionInput = z.infer<typeof startSubscriptionInput>;

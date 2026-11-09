import { z } from 'zod';

/** §5.1 body. The amount never comes from the client (INV-05); the exhibitor is the caller's. */
export const createReservationInput = z.strictObject({
  eventStandId: z.uuid(),
  termsVersion: z.string().trim().min(1).max(40),
  /** Optional, as in §5.1; when sent it must be the caller's own exhibitor profile. */
  exhibitorId: z.uuid().optional(),
});

export const listReservationsQuery = z.strictObject({
  eventId: z.uuid().optional(),
});

export type CreateReservationInput = z.infer<typeof createReservationInput>;

/** PAY-06 body: no amount refunds every payment in full; an amount refunds part of one payment. */
export const refundInput = z.strictObject({
  amountCents: z.number().int().positive().optional(),
});

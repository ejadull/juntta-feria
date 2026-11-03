import { z } from 'zod';
import { VENUE_TYPES } from '../db/schema.js';

const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

/** Positive meters with at most two decimals (the column is numeric(10,2)). */
const meters = z
  .number()
  .positive()
  .max(100_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    error: 'must have at most two decimals',
  });

const fields = {
  type: z.enum(VENUE_TYPES),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(300).nullable(),
  timezone: z.string().refine(isTimeZone, { error: 'must be an IANA time zone' }),
  widthM: meters,
  heightM: meters,
};

/** Unknown fields (e.g. tenantId) are rejected: the tenant only comes from the session. */
export const createVenueInput = z.strictObject({
  ...fields,
  address: fields.address.optional(),
});

export const updateVenueInput = z
  .strictObject(fields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    error: 'at least one field is required',
  });

export type CreateVenueInput = z.infer<typeof createVenueInput>;
export type UpdateVenueInput = z.infer<typeof updateVenueInput>;

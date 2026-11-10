import { z } from 'zod';

/** ISO 8601 with an explicit offset: a bare local time is ambiguous for an event in another zone. */
const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const slug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    error: 'lowercase letters, digits and dashes',
  });

const name = z.string().trim().min(1).max(120);

export interface EventDates {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly salesOpenAt: Date;
  readonly salesCloseAt: Date;
}

/** Same rule as the `events_dates_check` constraint; null when the dates are coherent. */
export function datesProblem(d: EventDates): string | null {
  if (d.startsAt >= d.endsAt) return 'startsAt must be before endsAt';
  if (d.salesOpenAt >= d.salesCloseAt)
    return 'salesOpenAt must be before salesCloseAt';
  if (d.salesCloseAt > d.endsAt) return 'salesCloseAt must not be after endsAt';
  return null;
}

export const createEventInput = z
  .strictObject({
    venueId: z.uuid(),
    layoutVersionId: z.uuid(),
    name,
    slug: slug.optional(),
    startsAt: instant,
    endsAt: instant,
    salesOpenAt: instant,
    salesCloseAt: instant,
  })
  .superRefine((event, ctx) => {
    const problem = datesProblem(event);
    if (problem)
      ctx.addIssue({ code: 'custom', message: problem, path: ['dates'] });
  });

/** Draft edits; the merged dates are checked against the stored ones in the service. */
export const updateEventInput = z
  .strictObject({
    name,
    slug,
    startsAt: instant,
    endsAt: instant,
    salesOpenAt: instant,
    salesCloseAt: instant,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    error: 'at least one field is required',
  });

const sectorName = z.string().trim().min(1).max(80);
const sortOrder = z.int().min(0).max(1000);

export const createSectorInput = z.strictObject({
  name: sectorName,
  sortOrder: sortOrder.optional(),
});

export const updateSectorInput = z
  .strictObject({ name: sectorName, sortOrder })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    error: 'at least one field is required',
  });

/** Organizer-settable states; ASSIGNED only comes from a confirmed reservation (RES-01). */
const editableStatus = z.enum(['AVAILABLE', 'BLOCKED', 'DISABLED']);

/** Bulk inventory edit (P09): price in cents, sector (null clears it) and/or status. */
export const updateStandsInput = z
  .strictObject({
    standIds: z
      .array(z.uuid())
      .min(1)
      .max(2000)
      .refine((ids) => new Set(ids).size === ids.length, {
        error: 'stand ids must be unique',
      }),
    priceCents: z.int().min(0).max(1_000_000_000_000).optional(),
    sectorId: z.uuid().nullable().optional(),
    status: editableStatus.optional(),
  })
  .refine(
    (p) =>
      p.priceCents !== undefined ||
      p.sectorId !== undefined ||
      p.status !== undefined,
    { error: 'priceCents, sectorId or status is required' },
  );

export type CreateEventInput = z.infer<typeof createEventInput>;
export type UpdateEventInput = z.infer<typeof updateEventInput>;
export type CreateSectorInput = z.infer<typeof createSectorInput>;
export type UpdateSectorInput = z.infer<typeof updateSectorInput>;
export type UpdateStandsInput = z.infer<typeof updateStandsInput>;

/** "Feria de Primavera 2026" → "feria-de-primavera-2026" (accents dropped). */
export function slugify(text: string): string {
  const base = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return base || 'evento';
}

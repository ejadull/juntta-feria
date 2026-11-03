import { z } from 'zod';
import { LAYOUT_OBJECT_KINDS } from '../db/schema.js';
import { meters } from '../venues/venue.input.js';

/** ADR 0001: the SVG editor is sized for ~2000 objects; beyond that the design is reopened. */
export const MAX_OBJECTS = 2000;
const MAX_METADATA_BYTES = 4096;

const coordinate = z.number().min(-1_000_000).max(1_000_000);
const position = z.tuple([coordinate, coordinate]);

const closed = (ring: [number, number][]) => {
  const [first, last] = [ring[0], ring.at(-1)];
  return !!first && !!last && first[0] === last[0] && first[1] === last[1];
};

/** GeoJSON Polygon with only an exterior ring, closed, in local meters (LUI-05 D2). */
const polygon = z.strictObject({
  type: z.literal('Polygon'),
  coordinates: z
    .array(
      z.array(position).min(4).max(1000).refine(closed, { error: 'ring must be closed' }),
    )
    .length(1),
});

const layoutObject = z.strictObject({
  id: z.uuid(),
  kind: z.enum(LAYOUT_OBJECT_KINDS),
  code: z.string().trim().min(1).max(20).nullable(),
  geometry: polygon,
  metadata: z
    .record(z.string(), z.unknown())
    .refine((m) => JSON.stringify(m).length <= MAX_METADATA_BYTES, {
      error: `must be at most ${MAX_METADATA_BYTES} bytes`,
    }),
});

/**
 * A whole draft as the editor saves it. Structure is checked here; layout rules (INV-04) are
 * checked only on publish, so a draft can be saved half-done.
 */
export const saveObjectsInput = z.strictObject({
  objects: z
    .array(layoutObject)
    .max(MAX_OBJECTS)
    .refine((objects) => new Set(objects.map((o) => o.id)).size === objects.length, {
      error: 'object ids must be unique',
    }),
});

/** The size comes from the venue unless given; a template without venue must give it. */
export const createTemplateInput = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    venueId: z.uuid().optional(),
    widthM: meters.optional(),
    heightM: meters.optional(),
  })
  .refine((t) => (t.widthM === undefined) === (t.heightM === undefined), {
    error: 'widthM and heightM go together',
    path: ['widthM'],
  })
  .refine((t) => t.venueId !== undefined || t.widthM !== undefined, {
    error: 'size is required without a venue',
    path: ['widthM'],
  });

export const cloneVersionInput = z.strictObject({ sourceVersionId: z.uuid() });

export type LayoutObjectInput = z.infer<typeof layoutObject>;
export type CreateTemplateInput = z.infer<typeof createTemplateInput>;

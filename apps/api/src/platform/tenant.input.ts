import { z } from 'zod';

/** Same shape as the `tenants_slug_check` constraint. */
const slug = z
  .string()
  .trim()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/** Same policy as accepting an invitation (EXH-04). */
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const createTenantInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  slug,
  owner: z.strictObject({
    email,
    fullName: z.string().trim().min(1).max(120),
    /** Only with AUTH_PASSWORD_ENABLED; otherwise the owner is created pending and binds Google (ADR 0008). */
    password: z.string().min(10).max(256).optional(),
  }),
});

export type CreateTenantInput = z.infer<typeof createTenantInput>;

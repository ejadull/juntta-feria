import { z } from 'zod';

/** "+54 9 11 2345-6789" → "5491123456789" (E.164 digits, as wa.me expects them). */
export const phoneInput = z
  .string()
  .max(30)
  .transform((value) => value.replace(/\D/g, ''))
  .refine((digits) => digits.length >= 8 && digits.length <= 15, {
    error: 'must be a phone number with country code',
  });

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** What the organizer knows about the future exhibitor; all optional (a bare link is valid). */
export const createInvitationInput = z.strictObject({
  email: email.optional(),
  phone: phoneInput.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  expiresInDays: z.int().min(1).max(30).default(7),
});

/** Basic data asked to the exhibitor when accepting (EXH-04). */
export const acceptInvitationInput = z.strictObject({
  fullName: z.string().trim().min(1).max(120),
  email,
  password: z.string().min(10).max(256),
  phone: phoneInput.optional(),
});

/**
 * Accepting with a Google ID token instead of a password (CORE-05). The email comes from the
 * verified token, so it is not asked; there is no password field at all.
 */
export const acceptInvitationWithGoogleInput = z.strictObject({
  googleCredential: z.string().min(1).max(4096),
  fullName: z.string().trim().min(1).max(120).optional(),
  phone: phoneInput.optional(),
});

/** 256-bit base64url token from the link; anything else cannot be an invitation. */
export const invitationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export type CreateInvitationInput = z.infer<typeof createInvitationInput>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInput>;
export type AcceptInvitationWithGoogleInput = z.infer<
  typeof acceptInvitationWithGoogleInput
>;

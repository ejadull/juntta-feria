import {
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  GoogleCredentialError,
  type GoogleIdentity,
  type GoogleIdTokenVerifier,
} from './google-id-token.verifier.js';
import { GoogleKeysUnavailableError } from './google-keys.js';

/** Provider token for the verifier; `null` when GOOGLE_CLIENT_ID is not configured. */
export const GOOGLE_ID_TOKEN_VERIFIER = Symbol('GOOGLE_ID_TOKEN_VERIFIER');

export type GoogleVerifier = GoogleIdTokenVerifier | null;

/** Machine-readable `code`s of the problem+json answers of Google sign-in (CORE-05). */
export const GOOGLE_CODES = {
  unavailable: 'GOOGLE_SIGN_IN_UNAVAILABLE',
  invalid: 'GOOGLE_CREDENTIAL_INVALID',
  mismatch: 'GOOGLE_ACCOUNT_MISMATCH',
  notRegistered: 'GOOGLE_ACCOUNT_NOT_REGISTERED',
} as const;

export const googleUnavailable = (): HttpException =>
  new ServiceUnavailableException({
    message: 'Sign in with Google is not available.',
    code: GOOGLE_CODES.unavailable,
  });

export const googleInvalid = (): HttpException =>
  new UnauthorizedException({
    message: 'The Google credential is not valid.',
    code: GOOGLE_CODES.invalid,
  });

/**
 * Verifies a credential and maps failures to HTTP: 503 if Google sign-in is not configured or
 * Google's keys cannot be loaded, 401 for an invalid credential (after `onInvalid`, which lets
 * the caller throttle the attempt).
 */
export async function verifyGoogleCredential(
  verifier: GoogleVerifier,
  credential: string,
  onInvalid?: () => Promise<void>,
): Promise<GoogleIdentity> {
  if (!verifier) throw googleUnavailable();
  try {
    return await verifier.verify(credential);
  } catch (error) {
    if (error instanceof GoogleKeysUnavailableError) throw googleUnavailable();
    if (!(error instanceof GoogleCredentialError)) throw error;
    await onInvalid?.();
    throw googleInvalid();
  }
}

import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { GoogleKeysUnavailableError } from './google-keys.js';

const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
/** Seconds of clock difference tolerated for exp and iat. */
const CLOCK_SKEW_SECONDS = 60;

export interface GoogleIdentity {
  /** Google's stable, never reused account id. */
  readonly sub: string;
  readonly email: string;
  readonly name: string | undefined;
}

/** The credential is not a valid Google ID token for this app; the reason is deliberately not exposed. */
export class GoogleCredentialError extends Error {
  constructor(options?: ErrorOptions) {
    super('Invalid Google credential.', options);
    this.name = 'GoogleCredentialError';
  }
}

/**
 * Verifies a Google Identity Services ID token (CORE-05, ADR 0008): RS256 signature against
 * Google's keys, audience = our client id, Google issuer, exp/iat with a small skew, and a
 * verified email. Throws GoogleCredentialError, or GoogleKeysUnavailableError if Google's keys
 * cannot be loaded.
 */
export class GoogleIdTokenVerifier {
  constructor(
    private readonly clientId: string,
    private readonly getKey: JWTVerifyGetKey,
  ) {}

  async verify(credential: string): Promise<GoogleIdentity> {
    try {
      const { payload } = await jwtVerify(credential, this.getKey, {
        algorithms: ['RS256'], // pins the algorithm: "none" and HMAC confusion fail
        audience: this.clientId,
        issuer: ISSUERS,
        clockTolerance: CLOCK_SKEW_SECONDS,
        requiredClaims: ['exp', 'iat', 'sub'],
      });
      const now = Math.floor(Date.now() / 1000);
      if (
        typeof payload.iat !== 'number' ||
        payload.iat > now + CLOCK_SKEW_SECONDS
      )
        throw new GoogleCredentialError();
      if (typeof payload.sub !== 'string' || payload.sub === '')
        throw new GoogleCredentialError();
      if (payload.email_verified !== true) throw new GoogleCredentialError();
      if (typeof payload.email !== 'string' || payload.email === '')
        throw new GoogleCredentialError();
      return {
        sub: payload.sub,
        email: payload.email,
        name: typeof payload.name === 'string' ? payload.name : undefined,
      };
    } catch (error) {
      if (
        error instanceof GoogleCredentialError ||
        error instanceof GoogleKeysUnavailableError
      )
        throw error;
      throw new GoogleCredentialError({ cause: error });
    }
  }
}

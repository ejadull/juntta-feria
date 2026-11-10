import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { GoogleKeys } from '../src/auth/google-keys.js';

export const GOOGLE_CLIENT_ID = 'int-client.apps.googleusercontent.com';

export interface IdTokenClaims {
  readonly sub: string;
  readonly email: string;
  readonly name?: string;
  readonly emailVerified?: boolean;
  readonly aud?: string;
}

export interface GoogleFixture {
  /** Google's keys replaced by a locally generated pair: nothing reaches the network. */
  readonly keys: GoogleKeys;
  readonly idToken: (claims: IdTokenClaims) => Promise<string>;
}

/** Signs ID tokens like Google would, with a stubbed JWKS (integration tests of CORE-05). */
export async function googleFixture(): Promise<GoogleFixture> {
  const pair = await generateKeyPair('RS256', { extractable: true });
  const jwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: 'int-key',
    alg: 'RS256',
  };
  const keys = new GoogleKeys(async () => ({
    jwks: { keys: [jwk] },
    maxAgeSeconds: 3600,
  }));
  const idToken = (c: IdTokenClaims) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      email: c.email,
      email_verified: c.emailVerified ?? true,
      ...(c.name ? { name: c.name } : {}),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'int-key' })
      .setSubject(c.sub)
      .setAudience(c.aud ?? GOOGLE_CLIENT_ID)
      .setIssuer('https://accounts.google.com')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(pair.privateKey);
  };
  return { keys, idToken };
}

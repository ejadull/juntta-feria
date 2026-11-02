import { createHmac, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

const ISSUER = 'juntta-feria';
const AUDIENCE = 'juntta-feria-api';
const ACCESS = 'access';

/** Short-lived HS256 access token (ADR 0004): kept in browser memory, sent as Bearer. */
export class AccessTokens {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(userId: string): Promise<{ token: string; expiresIn: number }> {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ typ: ACCESS })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + this.ttlSeconds)
      .sign(this.key);
    return { token, expiresIn: this.ttlSeconds };
  }

  /** The user id for a valid access token; null for anything else (never throws). */
  async verify(token: string): Promise<{ userId: string } | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'], // pins the algorithm: "none" and key-confusion tokens fail
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (payload.typ !== ACCESS || typeof payload.sub !== 'string') return null;
      return { userId: payload.sub };
    } catch {
      return null;
    }
  }
}

/** 256-bit opaque refresh token, URL-safe. Only its keyed hash is stored. */
export const newRefreshToken = (): string => randomBytes(32).toString('base64url');

/** HMAC-SHA256 with AUTH_REFRESH_TOKEN_SECRET: a leaked table alone cannot be replayed. */
export const hashRefreshToken = (token: string, secret: string): string =>
  createHmac('sha256', secret).update(token).digest('hex');

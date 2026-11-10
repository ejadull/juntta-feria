import { SignJWT } from 'jose';
import { AccessTokens, hashRefreshToken, newRefreshToken } from './tokens.js';

const SECRET = 'fake-access-secret-0123456789abcdef0123456789';
const OTHER = 'fake-other-secret-0123456789abcdef01234567890';
const USER = '33333333-3333-4333-8333-333333333333';

describe('AccessTokens (CORE-02, ADR 0004)', () => {
  const tokens = new AccessTokens(SECRET, 900);

  it('signs a short-lived JWT for the user and verifies it', async () => {
    const { token, expiresIn } = await tokens.sign(USER);
    expect(expiresIn).toBe(900);
    expect(token.split('.')).toHaveLength(3);
    await expect(tokens.verify(token)).resolves.toEqual({ userId: USER });
  });

  it('rejects a token signed with another secret', async () => {
    const { token } = await new AccessTokens(OTHER, 900).sign(USER);
    await expect(tokens.verify(token)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = await new SignJWT({ typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER)
      .setIssuer('juntta-feria')
      .setAudience('juntta-feria-api')
      .setIssuedAt(past - 900)
      .setExpirationTime(past)
      .sign(new TextEncoder().encode(SECRET));
    await expect(tokens.verify(token)).resolves.toBeNull();
  });

  it('rejects unsigned ("alg: none") and garbage tokens', async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: USER, typ: 'access' }),
    ).toString('base64url');
    await expect(tokens.verify(`${header}.${payload}.`)).resolves.toBeNull();
    await expect(tokens.verify('not.a.jwt')).resolves.toBeNull();
    await expect(tokens.verify('')).resolves.toBeNull();
  });

  it('rejects a token without the access type or subject', async () => {
    const token = await new SignJWT({ typ: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER)
      .setIssuer('juntta-feria')
      .setAudience('juntta-feria-api')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    await expect(tokens.verify(token)).resolves.toBeNull();
  });
});

describe('refresh tokens', () => {
  it('are random, URL-safe and at least 256 bits', () => {
    const a = newRefreshToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(newRefreshToken()).not.toBe(a);
  });

  it('are stored as a keyed hash: deterministic per secret, different across secrets', () => {
    const token = newRefreshToken();
    expect(hashRefreshToken(token, SECRET)).toBe(
      hashRefreshToken(token, SECRET),
    );
    expect(hashRefreshToken(token, SECRET)).not.toBe(
      hashRefreshToken(token, OTHER),
    );
    expect(hashRefreshToken(token, SECRET)).not.toContain(token);
  });
});

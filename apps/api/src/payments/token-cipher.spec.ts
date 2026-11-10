import { TokenCipher } from './token-cipher.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('TokenCipher (PAY-07, ADR 0006 §2)', () => {
  const cipher = new TokenCipher(KEY);

  it('round-trips a token without keeping it in clear', () => {
    const sealed = cipher.seal('APP_USR-secret-token');
    expect(sealed).not.toContain('APP_USR');
    expect(cipher.open(sealed)).toBe('APP_USR-secret-token');
  });

  it('uses a fresh IV per value', () => {
    expect(cipher.seal('same')).not.toBe(cipher.seal('same'));
  });

  it('rejects a tampered value or another key (GCM authentication)', () => {
    const sealed = cipher.seal('token');
    const [iv, tag, data] = sealed.split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(() =>
      cipher.open([iv, tag, flipped.toString('base64url')].join('.')),
    ).toThrow();
    expect(() =>
      new TokenCipher(Buffer.alloc(32, 8).toString('base64')).open(sealed),
    ).toThrow();
  });

  it('names its key with a stable id that reveals nothing of it', () => {
    expect(cipher.keyId).toBe(new TokenCipher(KEY).keyId);
    expect(cipher.keyId).toMatch(/^[0-9a-f]{12}$/);
    expect(
      new TokenCipher(Buffer.alloc(32, 8).toString('base64')).keyId,
    ).not.toBe(cipher.keyId);
  });
});

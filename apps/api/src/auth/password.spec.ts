import {
  hashPassword,
  verifyPassword,
  verifyAgainstDummy,
} from './password.js';

describe('password hashing (CORE-02, §8 Argon2id)', () => {
  it('stores an Argon2id hash, never the password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('correct horse');
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('s3cret-pass-phrase');
    await expect(verifyPassword(hash, 's3cret-pass-phrase')).resolves.toBe(
      true,
    );
    await expect(verifyPassword(hash, 's3cret-pass-phrasE')).resolves.toBe(
      false,
    );
  });

  it('returns false for a malformed stored hash instead of throwing', async () => {
    await expect(verifyPassword('not-a-hash', 'whatever')).resolves.toBe(false);
  });

  it('hashes the same password differently each time (random salt)', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('spends a real verification when the account does not exist (no timing oracle)', async () => {
    await expect(verifyAgainstDummy('any password')).resolves.toBe(false);
  });
});

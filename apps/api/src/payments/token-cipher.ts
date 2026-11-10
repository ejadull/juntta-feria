import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * AES-256-GCM for the sellers' OAuth tokens (PAY-07, ADR 0006 §2): only ciphertext and the
 * `keyId` reach the database. Output: `iv.tag.data` in base64url.
 * ponytail: the key comes from MP_TOKEN_ENCRYPTION_KEY; wrap it with KMS/vault before
 * production, rotating by re-encrypting the rows of the old `keyId`.
 */
export class TokenCipher {
  private readonly key: Buffer;
  readonly keyId: string;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32)
      throw new Error('The token key must be 32 bytes.');
    this.keyId = createHash('sha256')
      .update(this.key)
      .digest('hex')
      .slice(0, 12);
  }

  seal(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data]
      .map((part) => part.toString('base64url'))
      .join('.');
  }

  /** Throws when the value was tampered with or sealed with another key. */
  open(sealed: string): string {
    const [iv, tag, data] = sealed
      .split('.')
      .map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  }
}

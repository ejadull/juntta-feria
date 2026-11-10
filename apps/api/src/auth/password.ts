import { randomBytes } from 'node:crypto';
import { ForbiddenException, type HttpException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** Problem `code` when a password path is used while AUTH_PASSWORD_ENABLED is false (ADR 0008). */
export const PASSWORD_DISABLED_CODE = 'PASSWORD_SIGN_IN_DISABLED';

export const passwordDisabled = (): HttpException =>
  new ForbiddenException({
    message: 'Sign in with a password is not available.',
    code: PASSWORD_DISABLED_CODE,
  });

/**
 * Argon2id (the library default) with OWASP's minimum profile: 19 MiB, 2 passes, 1 lane.
 * ponytail: fixed cost; raise memoryCost when login latency budget allows, old hashes keep working.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> =>
  hash(password, OPTIONS);

/** False for a wrong password or a malformed stored hash; never throws on bad input. */
export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same work as a real check when the account does not exist, so response time does not
 * reveal which emails are registered. Always false.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  await verifyPassword(await dummyHash, password);
  return false;
}

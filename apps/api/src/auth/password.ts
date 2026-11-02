import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id (the library default) with OWASP's minimum profile: 19 MiB, 2 passes, 1 lane.
 * ponytail: fixed cost; raise memoryCost when login latency budget allows, old hashes keep working.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, OPTIONS);

/** False for a wrong password or a malformed stored hash; never throws on bad input. */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
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

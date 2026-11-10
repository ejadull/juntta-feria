import {
  createLocalJWKSet,
  errors,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from 'jose';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

const FETCH_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_AGE_SECONDS = 3_600;
const MIN_MAX_AGE_SECONDS = 60;
const MAX_MAX_AGE_SECONDS = 86_400;
/** An unknown key id forces a refetch, at most this often (key rotation without hammering Google). */
const UNKNOWN_KID_COOLDOWN_MS = 30_000;

export interface FetchedJwks {
  readonly jwks: JSONWebKeySet;
  readonly maxAgeSeconds: number;
}

export type JwksFetcher = () => Promise<FetchedJwks>;

/** Google's signing keys could not be loaded: not the caller's fault, so never a 401. */
export class GoogleKeysUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('Google signing keys are unavailable.', options);
    this.name = 'GoogleKeysUnavailableError';
  }
}

function maxAgeOf(cacheControl: string | null): number {
  const match = /max-age=(\d+)/i.exec(cacheControl ?? '');
  const seconds = match ? Number(match[1]) : DEFAULT_MAX_AGE_SECONDS;
  return Math.min(Math.max(seconds, MIN_MAX_AGE_SECONDS), MAX_MAX_AGE_SECONDS);
}

export const fetchGoogleJwks: JwksFetcher = async () => {
  const response = await fetch(GOOGLE_JWKS_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!response.ok)
    throw new Error(`JWKS endpoint answered ${response.status}`);
  const body = (await response.json()) as Partial<JSONWebKeySet>;
  if (!Array.isArray(body.keys)) throw new Error('JWKS body has no keys');
  return {
    jwks: { keys: body.keys },
    maxAgeSeconds: maxAgeOf(response.headers.get('cache-control')),
  };
};

type KeySet = ReturnType<typeof createLocalJWKSet>;

/**
 * Google's public keys, cached for the `Cache-Control: max-age` they came with. jose's own remote
 * set uses a fixed TTL, so this small wrapper honors the header; verification stays with jose.
 */
export class GoogleKeys {
  private keySet: KeySet | undefined;
  private expiresAt = 0;
  private fetchedAt = 0;
  private loading: Promise<KeySet> | undefined;

  constructor(
    private readonly fetchJwks: JwksFetcher = fetchGoogleJwks,
    private readonly now: () => number = Date.now,
  ) {}

  /** Passed to `jwtVerify` as the key resolver. */
  readonly getKey: JWTVerifyGetKey = async (header, token) => {
    const current = await this.current();
    try {
      return await current(header, token);
    } catch (error) {
      const unknown = error instanceof errors.JWKSNoMatchingKey;
      if (!unknown || this.now() - this.fetchedAt < UNKNOWN_KID_COOLDOWN_MS)
        throw error;
      return (await this.refresh())(header, token);
    }
  };

  private current(): Promise<KeySet> {
    return this.keySet && this.now() < this.expiresAt
      ? Promise.resolve(this.keySet)
      : this.refresh();
  }

  private refresh(): Promise<KeySet> {
    this.loading ??= this.fetchJwks()
      .then(({ jwks, maxAgeSeconds }) => {
        this.keySet = createLocalJWKSet(jwks);
        this.fetchedAt = this.now();
        this.expiresAt = this.fetchedAt + maxAgeSeconds * 1000;
        return this.keySet;
      })
      .catch((cause: unknown) => {
        throw new GoogleKeysUnavailableError({ cause });
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }
}

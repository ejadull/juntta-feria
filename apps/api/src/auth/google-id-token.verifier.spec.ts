import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
  type JWK,
} from 'jose';
import {
  GoogleKeys,
  GoogleKeysUnavailableError,
  type JwksFetcher,
} from './google-keys.js';
import {
  GoogleCredentialError,
  GoogleIdTokenVerifier,
} from './google-id-token.verifier.js';

/** CORE-05: Google ID token verification with locally generated keys; nothing reaches Google. */

const CLIENT_ID = 'fake-client-id.apps.googleusercontent.com';
const KID = 'test-key-1';

type Pair = Awaited<ReturnType<typeof generateKeyPair>>;
let pair: Pair;
let other: Pair;
let publicJwk: JWK;

beforeAll(async () => {
  pair = await generateKeyPair('RS256', { extractable: true });
  other = await generateKeyPair('RS256', { extractable: true });
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256' };
});

const jwks = (): JSONWebKeySet => ({ keys: [publicJwk] });
const fetcher = (maxAgeSeconds = 3600): JwksFetcher =>
  vi.fn(async () => ({ jwks: jwks(), maxAgeSeconds }));

interface TokenOptions {
  readonly key?: Pair['privateKey'];
  readonly kid?: string;
  readonly aud?: string;
  readonly iss?: string;
  readonly exp?: number;
  readonly iat?: number;
  readonly claims?: Record<string, unknown>;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function sign(o: TokenOptions = {}): Promise<string> {
  return new SignJWT({
    email: 'ana@example.com',
    email_verified: true,
    name: 'Ana',
    ...o.claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: o.kid ?? KID })
    .setSubject('google-sub-1')
    .setAudience(o.aud ?? CLIENT_ID)
    .setIssuer(o.iss ?? 'https://accounts.google.com')
    .setIssuedAt(o.iat ?? nowSeconds())
    .setExpirationTime(o.exp ?? nowSeconds() + 3600)
    .sign(o.key ?? pair.privateKey);
}

const verifier = (fetchJwks: JwksFetcher = fetcher()) =>
  new GoogleIdTokenVerifier(CLIENT_ID, new GoogleKeys(fetchJwks).getKey);

describe('GoogleIdTokenVerifier', () => {
  it('returns the identity of a valid token', async () => {
    await expect(verifier().verify(await sign())).resolves.toEqual({
      sub: 'google-sub-1',
      email: 'ana@example.com',
      name: 'Ana',
    });
  });

  it('accepts the bare accounts.google.com issuer too', async () => {
    const token = await sign({ iss: 'accounts.google.com' });
    await expect(verifier().verify(token)).resolves.toMatchObject({
      sub: 'google-sub-1',
    });
  });

  it('rejects a token signed with another key', async () => {
    const token = await sign({ key: other.privateKey });
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(
      GoogleCredentialError,
    );
  });

  it('rejects a tampered payload', async () => {
    const [h, , s] = (await sign()).split('.');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'x', email: 'evil@example.com' }),
    ).toString('base64url');
    await expect(
      verifier().verify(`${h}.${payload}.${s}`),
    ).rejects.toBeInstanceOf(GoogleCredentialError);
  });

  it('rejects another audience', async () => {
    const token = await sign({
      aud: 'someone-else.apps.googleusercontent.com',
    });
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(
      GoogleCredentialError,
    );
  });

  it('rejects another issuer', async () => {
    const token = await sign({ iss: 'https://evil.example' });
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(
      GoogleCredentialError,
    );
  });

  it('rejects an expired token but tolerates a few seconds of skew', async () => {
    const expired = await sign({
      iat: nowSeconds() - 7200,
      exp: nowSeconds() - 600,
    });
    await expect(verifier().verify(expired)).rejects.toBeInstanceOf(
      GoogleCredentialError,
    );
    const skewed = await sign({
      iat: nowSeconds() - 3600,
      exp: nowSeconds() - 10,
    });
    await expect(verifier().verify(skewed)).resolves.toBeDefined();
  });

  it('rejects a token issued in the future beyond the skew', async () => {
    const token = await sign({ iat: nowSeconds() + 600 });
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(
      GoogleCredentialError,
    );
  });

  it.each([
    ['false', { email_verified: false }],
    ['the string "true"', { email_verified: 'true' }],
    ['missing', { email_verified: undefined }],
  ])('rejects an unverified email (%s)', async (_case, claims) => {
    const token = await sign({ claims });
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(
      GoogleCredentialError,
    );
  });

  it('rejects a token without email', async () => {
    const token = await sign({ claims: { email: undefined } });
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(
      GoogleCredentialError,
    );
  });

  it('rejects unsigned and garbage tokens', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString(
      'base64url',
    );
    const body = Buffer.from(
      JSON.stringify({ sub: 'x', email: 'ana@example.com' }),
    ).toString('base64url');
    for (const bad of [`${header}.${body}.`, 'not-a-jwt', ''])
      await expect(verifier().verify(bad)).rejects.toBeInstanceOf(
        GoogleCredentialError,
      );
  });

  it('rejects a token whose key id is unknown', async () => {
    const token = await sign({ kid: 'rotated-away' });
    await expect(verifier().verify(token)).rejects.toBeInstanceOf(
      GoogleCredentialError,
    );
  });

  it('reports unreachable keys as unavailable, not as an invalid credential', async () => {
    const down: JwksFetcher = async () => {
      throw new Error('network down');
    };
    await expect(verifier(down).verify(await sign())).rejects.toBeInstanceOf(
      GoogleKeysUnavailableError,
    );
  });
});

describe('GoogleKeys cache', () => {
  it('fetches once and reuses the keys until max-age elapses', async () => {
    let now = Date.now();
    const fetchJwks = fetcher(300);
    const keys = new GoogleKeys(fetchJwks, () => now);
    const v = new GoogleIdTokenVerifier(CLIENT_ID, keys.getKey);
    const token = await sign();

    await v.verify(token);
    await v.verify(token);
    expect(fetchJwks).toHaveBeenCalledTimes(1);

    now += 301_000;
    await v.verify(token);
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  it('refreshes early for an unknown kid, but not more than once per cooldown', async () => {
    let now = Date.now();
    const fetchJwks = fetcher(3600);
    const keys = new GoogleKeys(fetchJwks, () => now);
    const v = new GoogleIdTokenVerifier(CLIENT_ID, keys.getKey);
    const unknown = await sign({ kid: 'unknown' });

    await v.verify(await sign()); // 1 fetch
    await expect(v.verify(unknown)).rejects.toBeInstanceOf(
      GoogleCredentialError,
    );
    expect(fetchJwks).toHaveBeenCalledTimes(1); // within the cooldown: no hammering

    now += 60_000;
    await expect(v.verify(unknown)).rejects.toBeInstanceOf(
      GoogleCredentialError,
    );
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent verifications', async () => {
    const fetchJwks = fetcher();
    const v = new GoogleIdTokenVerifier(
      CLIENT_ID,
      new GoogleKeys(fetchJwks).getKey,
    );
    const token = await sign();
    await Promise.all([v.verify(token), v.verify(token), v.verify(token)]);
    expect(fetchJwks).toHaveBeenCalledTimes(1);
  });
});

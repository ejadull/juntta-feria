export interface RatePolicy {
  /** Policy name: a Structured Fields String, so it must be plain ASCII without quotes. */
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

export interface RateUsage {
  /** Hits in the current window, this one included. */
  readonly count: number;
  /** Seconds until the window resets; <= 0 means the store did not say. */
  readonly ttl: number;
}

/** Whole seconds until the window resets (also the value of Retry-After, RFC 9110 §10.2.3). */
export const secondsToReset = (policy: RatePolicy, usage: RateUsage): number =>
  usage.ttl > 0 ? usage.ttl : policy.windowSeconds;

/**
 * Quota fields of draft-ietf-httpapi-ratelimit-headers-11 (IETF, May 2026; still an Internet-Draft,
 * so the syntax may change): both are Structured Field Lists whose item is the policy name.
 *   RateLimit-Policy: "public";q=120;w=60   -> quota and window of the policy
 *   RateLimit: "public";r=115;t=42          -> remaining quota and seconds until reset
 */
export function rateLimitHeaders(
  policy: RatePolicy,
  usage: RateUsage,
): { 'RateLimit-Policy': string; RateLimit: string } {
  const remaining = Math.max(0, policy.limit - usage.count);
  return {
    'RateLimit-Policy': `"${policy.name}";q=${policy.limit};w=${policy.windowSeconds}`,
    RateLimit: `"${policy.name}";r=${remaining};t=${secondsToReset(policy, usage)}`,
  };
}

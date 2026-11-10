import { createHash } from 'node:crypto';

/** The two operations the limiter needs; Redis in production, a Map in tests. */
export interface CounterStore {
  /** Increments `key`; starts its window only on the first hit. Returns count and seconds left. */
  incrementWithWindow(
    key: string,
    windowSeconds: number,
  ): Promise<{ count: number; ttl: number }>;
  reset(key: string): Promise<void>;
}

export interface LoginLimits {
  readonly perEmail: number;
  readonly perIp: number;
  readonly windowSeconds: number;
}

export type RateDecision =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Emails are keyed by a hash: the counter store never holds them in clear. */
const emailKey = (email: string): string =>
  `auth:login:email:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;
const ipKey = (ip: string): string => `auth:login:ip:${ip}`;

/**
 * Fixed-window login throttling per email (credential stuffing on one account) and per IP
 * (one client spraying many accounts). Every attempt counts; a success clears the email bucket.
 */
export class LoginRateLimiter {
  constructor(
    private readonly store: CounterStore,
    private readonly limits: LoginLimits,
  ) {}

  async hit(ip: string, email: string): Promise<RateDecision> {
    const { windowSeconds, perEmail, perIp } = this.limits;
    const [byEmail, byIp] = await Promise.all([
      this.store.incrementWithWindow(emailKey(email), windowSeconds),
      this.store.incrementWithWindow(ipKey(ip), windowSeconds),
    ]);
    const blocked = [
      byEmail.count > perEmail ? byEmail.ttl : 0,
      byIp.count > perIp ? byIp.ttl : 0,
    ].filter((ttl) => ttl > 0);
    return blocked.length === 0
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds: Math.max(...blocked) };
  }

  async succeeded(email: string): Promise<void> {
    await this.store.reset(emailKey(email));
  }
}

import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import {
  DatabaseService,
  isUniqueViolation,
  type Database,
  type Transaction,
} from '../db/database.service.js';
import {
  memberships,
  refreshTokens,
  tenants,
  users,
  type MembershipRole,
} from '../db/schema.js';
import type { GoogleIdentity } from './google-id-token.verifier.js';
import { verifyAgainstDummy, verifyPassword } from './password.js';
import { AccessTokens, hashRefreshToken, newRefreshToken } from './tokens.js';

export interface MembershipView {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly tenantName: string;
  readonly role: MembershipRole;
}

export interface Profile {
  readonly user: {
    readonly id: string;
    readonly email: string;
    /** Shown in the web greeting; null until set (invitation, tenant creation or Google). */
    readonly fullName: string | null;
  };
  readonly memberships: readonly MembershipView[];
}

/** GET /me: the profile plus whether the user is a platform administrator (CORE-04). */
export interface MeView extends Profile {
  readonly platformAdmin: boolean;
}

/** What a successful login/refresh returns; the refresh token only travels in the cookie. */
export interface Session extends Profile {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: string;
}

/** Outcome of signing in with a verified Google identity (CORE-05). */
export type GoogleLoginResult =
  | { readonly status: 'ok'; readonly session: Session }
  /** The account is bound to another Google subject. */
  | { readonly status: 'mismatch' }
  | { readonly status: 'not-registered' }
  /** Disabled account: answered like a failed password login. */
  | { readonly status: 'inactive' };

/**
 * Login, refresh rotation with reuse detection, logout and profile (CORE-02, ADR 0004).
 * Every failure returns null so callers answer with one generic message.
 */
@Injectable()
export class AuthService {
  private readonly access: AccessTokens;
  private readonly refreshSecret: string;
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly database: DatabaseService,
    @Inject(configuration.KEY) env: AppConfiguration,
  ) {
    this.access = new AccessTokens(
      env.auth.accessTokenSecret,
      env.auth.accessTokenTtlSeconds,
    );
    this.refreshSecret = env.auth.refreshTokenSecret;
    this.refreshTtlSeconds = env.auth.refreshTokenTtlSeconds;
  }

  async login(email: string, password: string): Promise<Session | null> {
    const db = this.database.db;
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email.trim()})`)
      .limit(1);
    if (!user) return verifyAgainstDummy(password).then(() => null);
    // Google-only accounts have no password: same cost and same answer as a wrong one.
    if (!user.passwordHash)
      return verifyAgainstDummy(password).then(() => null);
    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid || user.status !== 'ACTIVE') return null;
    const refreshToken = await this.issueRefreshToken(
      db,
      user.id,
      randomUUID(),
    );
    return this.session(db, user, refreshToken);
  }

  /**
   * Existing accounts only (CORE-05, ADR 0008): match the stored Google subject, else the verified
   * email, binding the subject on first success. Never creates a user. The session is the same one
   * password login issues.
   */
  async loginWithGoogle(identity: GoogleIdentity): Promise<GoogleLoginResult> {
    const db = this.database.db;
    const [bySub] = await db
      .select()
      .from(users)
      .where(eq(users.googleSub, identity.sub))
      .limit(1);
    let user = bySub;
    if (!user) {
      const [byEmail] = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = lower(${identity.email.trim()})`)
        .limit(1);
      if (!byEmail) return { status: 'not-registered' };
      if (byEmail.googleSub && byEmail.googleSub !== identity.sub)
        return { status: 'mismatch' };
      user = byEmail;
    }
    if (user.status !== 'ACTIVE') return { status: 'inactive' };
    const googleName = identity.name?.trim().slice(0, 120);
    if (!user.fullName && googleName) {
      // Fills the name once from the Google profile; never overwrites one the account already has.
      await db
        .update(users)
        .set({ fullName: googleName })
        .where(and(eq(users.id, user.id), isNull(users.fullName)));
      user = { ...user, fullName: googleName };
    }
    if (!user.googleSub) {
      try {
        await db
          .update(users)
          .set({ googleSub: identity.sub })
          .where(and(eq(users.id, user.id), isNull(users.googleSub)));
      } catch (error) {
        if (isUniqueViolation(error)) return { status: 'mismatch' };
        throw error;
      }
    }
    const refreshToken = await this.issueRefreshToken(
      db,
      user.id,
      randomUUID(),
    );
    return {
      status: 'ok',
      session: await this.session(db, user, refreshToken),
    };
  }

  /**
   * Rotates a refresh token. The row is locked so two concurrent uses cannot both succeed; a token
   * that was already used revokes its whole family (stolen-token replay, ADR 0004).
   */
  async refresh(token: string): Promise<Session | null> {
    const tokenHash = hashRefreshToken(token, this.refreshSecret);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .for('update');
      if (!row || row.revokedAt) return null;
      if (row.usedAt) {
        await this.revokeFamily(tx, row.familyId);
        return null;
      }
      if (row.expiresAt.getTime() <= Date.now()) return null;

      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, row.userId));
      if (!user || user.status !== 'ACTIVE') {
        await this.revokeFamily(tx, row.familyId);
        return null;
      }
      await tx
        .update(refreshTokens)
        .set({ usedAt: new Date() })
        .where(eq(refreshTokens.id, row.id));
      const next = await this.issueRefreshToken(tx, user.id, row.familyId);
      return this.session(tx, user, next);
    });
  }

  /** Revokes the session family of this token. Idempotent; unknown tokens are ignored. */
  async logout(token: string): Promise<void> {
    const tokenHash = hashRefreshToken(token, this.refreshSecret);
    const [row] = await this.database.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    if (row) await this.revokeFamily(this.database.db, row.familyId);
  }

  verifyAccessToken(token: string): Promise<{ userId: string } | null> {
    return this.access.verify(token);
  }

  async profile(userId: string): Promise<MeView | null> {
    const db = this.database.db;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.status !== 'ACTIVE') return null;
    return {
      user: { id: user.id, email: user.email, fullName: user.fullName },
      memberships: await this.membershipsOf(db, user.id),
      platformAdmin: user.isPlatformAdmin,
    };
  }

  private async session(
    db: Database | Transaction,
    user: { id: string; email: string; fullName: string | null },
    refreshToken: string,
  ): Promise<Session> {
    const { token, expiresIn } = await this.access.sign(user.id);
    return {
      accessToken: token,
      expiresIn,
      refreshToken,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      memberships: await this.membershipsOf(db, user.id),
    };
  }

  private membershipsOf(
    db: Database | Transaction,
    userId: string,
  ): Promise<MembershipView[]> {
    return db
      .select({
        tenantId: tenants.id,
        tenantSlug: tenants.slug,
        tenantName: tenants.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, 'ACTIVE'),
          eq(tenants.status, 'ACTIVE'),
        ),
      )
      .orderBy(tenants.name);
  }

  private async issueRefreshToken(
    db: Database | Transaction,
    userId: string,
    familyId: string,
  ): Promise<string> {
    const token = newRefreshToken();
    await db.insert(refreshTokens).values({
      userId,
      familyId,
      tokenHash: hashRefreshToken(token, this.refreshSecret),
      expiresAt: new Date(Date.now() + this.refreshTtlSeconds * 1000),
    });
    return token;
  }

  private async revokeFamily(
    db: Database | Transaction,
    familyId: string,
  ): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.familyId, familyId),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }
}

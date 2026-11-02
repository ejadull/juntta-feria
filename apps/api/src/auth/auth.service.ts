import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { configuration, type AppConfiguration } from '../config/configuration.js';
import { DatabaseService, type Database, type Transaction } from '../db/database.service.js';
import { memberships, refreshTokens, tenants, users, type MembershipRole } from '../db/schema.js';
import { verifyAgainstDummy, verifyPassword } from './password.js';
import { AccessTokens, hashRefreshToken, newRefreshToken } from './tokens.js';

export interface MembershipView {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly tenantName: string;
  readonly role: MembershipRole;
}

export interface Profile {
  readonly user: { readonly id: string; readonly email: string };
  readonly memberships: readonly MembershipView[];
}

/** What a successful login/refresh returns; the refresh token only travels in the cookie. */
export interface Session extends Profile {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken: string;
}

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
    this.access = new AccessTokens(env.auth.accessTokenSecret, env.auth.accessTokenTtlSeconds);
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
    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid || user.status !== 'ACTIVE') return null;
    const refreshToken = await this.issueRefreshToken(db, user.id, randomUUID());
    return this.session(db, user, refreshToken);
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

      const [user] = await tx.select().from(users).where(eq(users.id, row.userId));
      if (!user || user.status !== 'ACTIVE') {
        await this.revokeFamily(tx, row.familyId);
        return null;
      }
      await tx.update(refreshTokens).set({ usedAt: new Date() }).where(eq(refreshTokens.id, row.id));
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

  async profile(userId: string): Promise<Profile | null> {
    const db = this.database.db;
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.status !== 'ACTIVE') return null;
    return { user: { id: user.id, email: user.email }, memberships: await this.membershipsOf(db, user.id) };
  }

  private async session(
    db: Database | Transaction,
    user: { id: string; email: string },
    refreshToken: string,
  ): Promise<Session> {
    const { token, expiresIn } = await this.access.sign(user.id);
    return {
      accessToken: token,
      expiresIn,
      refreshToken,
      user: { id: user.id, email: user.email },
      memberships: await this.membershipsOf(db, user.id),
    };
  }

  private membershipsOf(db: Database | Transaction, userId: string): Promise<MembershipView[]> {
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

  private async revokeFamily(db: Database | Transaction, familyId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}

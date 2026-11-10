import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { DatabaseService } from '../db/database.service.js';
import { sellerAccounts } from '../db/schema.js';
import { AuditService } from '../tenancy/audit.service.js';
import {
  OAUTH_CLIENT,
  type OAuthClient,
  type SellerTokens,
} from './mercadopago-oauth.js';
import { paymentsUnavailable } from './payment-provider.js';
import { TokenCipher } from './token-cipher.js';

/** Renew a week ahead of the 180-day expiry, so a failed renewal leaves time to retry. */
const RENEW_MARGIN_MS = 7 * 86_400_000;
/** Mercado Pago's authorization code lives 10 minutes. */
const STATE_TTL_MS = 10 * 60_000;

export type SellerAccountStatus = 'NOT_LINKED' | 'LINKED' | 'EXPIRED';

/** P12: link state and environment, never a token (PAY-07). */
export interface SellerAccountView {
  readonly status: SellerAccountStatus;
  readonly environment: 'sandbox' | 'production';
  readonly sellerId: string | null;
  readonly liveMode: boolean | null;
  readonly expiresAt: Date | null;
  readonly linkedAt: Date | null;
}

/** What travels sealed inside `state`: the flow is bound to one tenant and one user. */
interface FlowState {
  readonly t: string;
  readonly u: string;
  /** PKCE verifier: only its S256 challenge goes to the provider in clear. */
  readonly v: string;
  readonly e: number;
}

type Account = typeof sellerAccounts.$inferSelect;

const invalidState = () =>
  new BadRequestException({
    code: 'INVALID_OAUTH_STATE',
    message: 'The authorization is invalid or expired.',
  });

/**
 * Organizer's Mercado Pago seller account (PAY-07, ADR 0006 §2): OAuth `authorization_code` with
 * PKCE, tokens sealed with AES-256-GCM, renewal serialized per tenant (`FOR UPDATE`) because each
 * refresh rotates the refresh token and a concurrent one would invalidate it.
 * The `state` is sealed with the same key, so no table is needed for in-flight authorizations.
 */
@Injectable()
export class SellerAccountsService {
  private readonly logger = new Logger(SellerAccountsService.name);
  private readonly cipher: TokenCipher | null;
  private readonly environment: 'sandbox' | 'production';

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(OAUTH_CLIENT) private readonly oauth: OAuthClient | null,
    @Inject(configuration.KEY) env: AppConfiguration,
  ) {
    const { tokenKey, environment } = env.mercadoPago;
    this.cipher = tokenKey ? new TokenCipher(tokenKey) : null;
    this.environment = environment;
  }

  async status(tenantId: string): Promise<SellerAccountView> {
    const account = await this.find(tenantId);
    return this.view(account);
  }

  authorize(tenantId: string, userId: string): { authorizationUrl: string } {
    const { oauth, cipher } = this.configured();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const flow: FlowState = {
      t: tenantId,
      u: userId,
      v: verifier,
      e: Date.now() + STATE_TTL_MS,
    };
    return {
      authorizationUrl: oauth.authorizationUrl(
        cipher.seal(JSON.stringify(flow)),
        challenge,
      ),
    };
  }

  async link(
    tenantId: string,
    userId: string,
    code: string,
    state: string,
  ): Promise<SellerAccountView> {
    const { oauth, cipher } = this.configured();
    const flow = this.openState(cipher, state);
    if (flow.t !== tenantId || flow.u !== userId || flow.e < Date.now())
      throw invalidState();
    const tokens = await oauth.exchange(code, flow.v);
    const account = await this.database.withTenant(tenantId, async (tx) => {
      const [previous] = await tx
        .select({ sellerId: sellerAccounts.sellerId })
        .from(sellerAccounts);
      const values = {
        ...this.sealed(cipher, tokens),
        linkedBy: userId,
        linkedAt: new Date(),
        refreshedAt: null,
      };
      const [row] = await tx
        .insert(sellerAccounts)
        .values(values)
        .onConflictDoUpdate({ target: sellerAccounts.tenantId, set: values })
        .returning();
      await this.audit.record(tx, {
        actorId: userId,
        action: 'payment_account.linked',
        entityType: 'seller_account',
        entityId: row.id,
        ...(previous ? { before: { sellerId: previous.sellerId } } : {}),
        after: {
          sellerId: row.sellerId,
          liveMode: row.liveMode,
          expiresAt: row.expiresAt,
        },
      });
      return row;
    });
    return this.view(account);
  }

  async unlink(tenantId: string, userId: string): Promise<void> {
    await this.database.withTenant(tenantId, async (tx) => {
      const [row] = await tx.delete(sellerAccounts).returning();
      if (!row) return;
      await this.audit.record(tx, {
        actorId: userId,
        action: 'payment_account.unlinked',
        entityType: 'seller_account',
        entityId: row.id,
        before: { sellerId: row.sellerId },
      });
    });
  }

  /**
   * The tenant's seller access token for the provider, renewed ahead of expiry; null when the
   * organization has not linked an account. An expired one that cannot be renewed → 503.
   */
  async accessToken(tenantId: string): Promise<string | null> {
    if (!this.cipher) return null;
    const account = await this.find(tenantId);
    if (!account) return null;
    if (!this.dueForRenewal(account))
      return this.cipher.open(account.accessTokenSealed);
    return this.renew(tenantId, this.cipher);
  }

  /**
   * Serialized per tenant: the lock is held across the provider call so a second caller waits
   * and then reads the rotated pair instead of spending the old refresh token.
   * ponytail: a network call inside the transaction; fine at one renewal per tenant per ~173 days.
   */
  private renew(tenantId: string, cipher: TokenCipher): Promise<string> {
    return this.database.withTenant(tenantId, async (tx) => {
      const [account] = await tx.select().from(sellerAccounts).for('update');
      if (!account) throw paymentsUnavailable(); // unlinked meanwhile
      if (!this.dueForRenewal(account))
        return cipher.open(account.accessTokenSealed);
      let tokens: SellerTokens;
      try {
        tokens = await this.configured().oauth.refresh(
          cipher.open(account.refreshTokenSealed),
        );
      } catch {
        // R-MP-4: alert; the organizer must relink once the token is gone.
        this.logger.warn(
          `Mercado Pago token renewal failed for tenant ${tenantId}`,
        );
        if (account.expiresAt.getTime() > Date.now())
          return cipher.open(account.accessTokenSealed);
        throw paymentsUnavailable();
      }
      await tx
        .update(sellerAccounts)
        .set({ ...this.sealed(cipher, tokens), refreshedAt: new Date() })
        .where(eq(sellerAccounts.id, account.id));
      return tokens.accessToken;
    });
  }

  private async find(tenantId: string): Promise<Account | undefined> {
    const [account] = await this.database.withTenant(tenantId, (tx) =>
      tx.select().from(sellerAccounts),
    );
    return account;
  }

  private dueForRenewal(account: Account): boolean {
    return account.expiresAt.getTime() - Date.now() < RENEW_MARGIN_MS;
  }

  private sealed(cipher: TokenCipher, tokens: SellerTokens) {
    return {
      sellerId: tokens.sellerId,
      liveMode: tokens.liveMode,
      accessTokenSealed: cipher.seal(tokens.accessToken),
      refreshTokenSealed: cipher.seal(tokens.refreshToken),
      keyId: cipher.keyId,
      expiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
    };
  }

  private openState(cipher: TokenCipher, state: string): FlowState {
    try {
      return JSON.parse(cipher.open(state)) as FlowState;
    } catch {
      throw invalidState();
    }
  }

  /** The OAuth app is optional (§13.1): without it, linking answers 503 and the rest works. */
  private configured(): { oauth: OAuthClient; cipher: TokenCipher } {
    if (!this.oauth || !this.cipher) throw paymentsUnavailable();
    return { oauth: this.oauth, cipher: this.cipher };
  }

  private view(account: Account | undefined): SellerAccountView {
    if (!account)
      return {
        status: 'NOT_LINKED',
        environment: this.environment,
        sellerId: null,
        liveMode: null,
        expiresAt: null,
        linkedAt: null,
      };
    return {
      status: account.expiresAt.getTime() > Date.now() ? 'LINKED' : 'EXPIRED',
      environment: this.environment,
      sellerId: account.sellerId,
      liveMode: account.liveMode,
      expiresAt: account.expiresAt,
      linkedAt: account.linkedAt,
    };
  }
}

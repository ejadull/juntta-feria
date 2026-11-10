import { Logger } from '@nestjs/common';
import { providerFailed } from './payment-provider.js';

const AUTHORIZE_URL = 'https://auth.mercadopago.com/authorization';
const TOKEN_URL = 'https://api.mercadopago.com/oauth/token';
const TIMEOUT_MS = 10_000;

/** A seller account's tokens as the OAuth server returns them (PAY-07). */
export interface SellerTokens {
  readonly accessToken: string;
  /** Rotates on every refresh: the previous one stops working (ADR 0006 §2). */
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
  readonly sellerId: string;
  readonly liveMode: boolean;
}

/** OAuth of the payment provider: each organizer authorizes the platform on its own account. */
export interface OAuthClient {
  authorizationUrl(state: string, codeChallenge: string): string;
  exchange(code: string, codeVerifier: string): Promise<SellerTokens>;
  refresh(refreshToken: string): Promise<SellerTokens>;
}

export const OAUTH_CLIENT = Symbol('OAuthClient');

export interface OAuthSettings {
  readonly environment: 'sandbox' | 'production';
  readonly clientId: string;
  readonly clientSecret: string;
  readonly oauthRedirectUri: string;
}

interface TokenResponse {
  readonly access_token?: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly user_id?: number | string;
  readonly live_mode?: boolean;
}

/**
 * Mercado Pago OAuth (`authorization_code` + PKCE S256, ADR 0006 §2). Plain `fetch`: the SDK's
 * OAuth client has no `code_verifier`. Responses never reach logs or clients.
 */
export class MercadoPagoOAuth implements OAuthClient {
  private readonly logger = new Logger(MercadoPagoOAuth.name);

  constructor(private readonly settings: OAuthSettings) {}

  authorizationUrl(state: string, codeChallenge: string): string {
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: this.settings.clientId,
      response_type: 'code',
      platform_id: 'mp',
      redirect_uri: this.settings.oauthRedirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  exchange(code: string, codeVerifier: string): Promise<SellerTokens> {
    return this.token('exchange', {
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: this.settings.oauthRedirectUri,
      // Sandbox links test accounts and returns test credentials.
      test_token: this.settings.environment === 'sandbox',
    });
  }

  refresh(refreshToken: string): Promise<SellerTokens> {
    return this.token('refresh', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  private async token(
    operation: string,
    grant: Record<string, unknown>,
  ): Promise<SellerTokens> {
    let response: Response;
    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: this.settings.clientId,
          client_secret: this.settings.clientSecret,
          ...grant,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      this.logger.warn(`Mercado Pago OAuth ${operation} failed (network)`);
      throw providerFailed();
    }
    const body = (await response.json().catch(() => ({}))) as TokenResponse;
    const { access_token, refresh_token, expires_in, user_id } = body;
    if (
      !response.ok ||
      !access_token ||
      !refresh_token ||
      !expires_in ||
      user_id === undefined
    ) {
      // Only the status: the body may echo the code or the tokens.
      this.logger.warn(
        `Mercado Pago OAuth ${operation} failed (${response.status})`,
      );
      throw providerFailed();
    }
    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresInSeconds: expires_in,
      sellerId: String(user_id),
      liveMode: body.live_mode === true,
    };
  }
}

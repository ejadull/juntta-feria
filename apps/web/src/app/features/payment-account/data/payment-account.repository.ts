import type { Observable } from 'rxjs';

export type SellerAccountStatus = 'NOT_LINKED' | 'LINKED' | 'EXPIRED';

/** `GET /api/v1/payment-account` (PAY-07): link state and environment, never a token. */
export interface SellerAccountDto {
  readonly status: SellerAccountStatus;
  readonly environment: 'sandbox' | 'production';
  readonly sellerId: string | null;
  readonly liveMode: boolean | null;
  /** ISO 8601. */
  readonly expiresAt: string | null;
  readonly linkedAt: string | null;
}

/**
 * Port for P12, the organization's Mercado Pago seller account. Also the DI token.
 * Errors carry the API problem `code` (e.g. INVALID_OAUTH_STATE) as `Error.message`.
 */
export abstract class PaymentAccountRepository {
  abstract status(): Observable<SellerAccountDto>;
  /** `POST /payment-account/authorization`: the Mercado Pago URL to send the browser to. */
  abstract startLink(): Observable<string>;
  /** `POST /payment-account/link` with what the redirect brought back. */
  abstract completeLink(code: string, state: string): Observable<SellerAccountDto>;
  abstract unlink(): Observable<void>;
}

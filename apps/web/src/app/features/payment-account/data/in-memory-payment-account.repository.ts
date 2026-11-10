import { defer, of, throwError, type Observable } from 'rxjs';
import { PaymentAccountRepository, type SellerAccountDto } from './payment-account.repository';

const DAY = 86_400_000;
export const DEMO_STATE = 'demo-state';

const unlinked: SellerAccountDto = {
  status: 'NOT_LINKED',
  environment: 'sandbox',
  sellerId: null,
  liveMode: null,
  expiresAt: null,
  linkedAt: null,
};

/**
 * Demo adapter until the web has a session (CORE-02): "Mercado Pago" is skipped and the
 * authorization URL goes straight to our return page, as the real redirect would.
 */
export class InMemoryPaymentAccountRepository extends PaymentAccountRepository {
  private account: SellerAccountDto = unlinked;

  status(): Observable<SellerAccountDto> {
    return defer(() => of(this.account));
  }

  startLink(): Observable<string> {
    return of(`/organizador/mercado-pago/vincular?code=demo-code&state=${DEMO_STATE}`);
  }

  completeLink(code: string, state: string): Observable<SellerAccountDto> {
    return defer(() => {
      if (state !== DEMO_STATE || !code) return throwError(() => new Error('INVALID_OAUTH_STATE'));
      const now = Date.now();
      this.account = {
        status: 'LINKED',
        environment: 'sandbox',
        sellerId: '123456789',
        liveMode: false,
        expiresAt: new Date(now + 180 * DAY).toISOString(),
        linkedAt: new Date(now).toISOString(),
      };
      return of(this.account);
    });
  }

  unlink(): Observable<void> {
    return defer(() => {
      this.account = unlinked;
      return of(undefined);
    });
  }
}

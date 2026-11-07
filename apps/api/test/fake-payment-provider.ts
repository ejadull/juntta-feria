import { randomUUID } from 'node:crypto';
import {
  providerFailed,
  type Checkout,
  type CheckoutRequest,
  type PaymentProvider,
  type ProviderPayment,
} from '../src/payments/payment-provider.js';

/** In-memory PaymentProvider (PAY-01): records checkouts and can fail the next call. */
export class FakePaymentProvider implements PaymentProvider {
  readonly checkouts: CheckoutRequest[] = [];
  private failures = 0;

  /** The next `count` provider calls fail with the adapter's 502. */
  failNext(count = 1): void {
    this.failures = count;
  }

  createCheckout(request: CheckoutRequest): Promise<Checkout> {
    this.checkouts.push(request);
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(providerFailed());
    }
    const preferenceId = `pref-${randomUUID()}`;
    return Promise.resolve({ preferenceId, checkoutUrl: `https://sandbox.mp.test/checkout/${preferenceId}` });
  }

  getPayment(): Promise<ProviderPayment> {
    return Promise.reject(new Error('FakePaymentProvider.getPayment is not scripted'));
  }

  refund(): Promise<{ id: string; status: string }> {
    return Promise.reject(new Error('FakePaymentProvider.refund is not scripted'));
  }

  cancel(): Promise<{ status: string }> {
    return Promise.reject(new Error('FakePaymentProvider.cancel is not scripted'));
  }
}

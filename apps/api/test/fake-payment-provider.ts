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
    return Promise.resolve({
      preferenceId,
      checkoutUrl: `https://sandbox.mp.test/checkout/${preferenceId}`,
    });
  }

  /** Payments the provider "has", by id; a missing one fails like the adapter (502). */
  readonly payments = new Map<string, ProviderPayment>();
  readonly paymentReads: { tenantId: string; paymentId: string }[] = [];

  getPayment(tenantId: string, paymentId: string): Promise<ProviderPayment> {
    this.paymentReads.push({ tenantId, paymentId });
    const payment = this.payments.get(paymentId);
    return payment
      ? Promise.resolve(payment)
      : Promise.reject(providerFailed());
  }

  findPayments(
    _tenantId: string,
    externalReference: string,
  ): Promise<ProviderPayment[]> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(providerFailed());
    }
    return Promise.resolve(
      [...this.payments.values()].filter(
        (p) => p.externalReference === externalReference,
      ),
    );
  }

  /** Refunds and cancellations sent, in order (PAY-06). */
  readonly reversals: {
    kind: 'refund' | 'cancel';
    paymentId: string;
    key: string;
    amountCents?: number;
  }[] = [];
  private reversalFailures = 0;

  /** The next `count` refunds or cancellations fail with the adapter's 502. */
  failNextReversal(count = 1): void {
    this.reversalFailures = count;
  }

  refund(
    _tenantId: string,
    paymentId: string,
    key: string,
    amountCents?: number,
  ): Promise<{ id: string; status: string }> {
    if (this.reversalFailed()) return Promise.reject(providerFailed());
    this.reversals.push({
      kind: 'refund',
      paymentId,
      key,
      ...(amountCents === undefined ? {} : { amountCents }),
    });
    const payment = this.payments.get(paymentId);
    if (payment && amountCents === undefined)
      this.payments.set(paymentId, { ...payment, status: 'refunded' });
    return Promise.resolve({ id: `refund-${key}`, status: 'approved' });
  }

  cancel(
    _tenantId: string,
    paymentId: string,
    key: string,
  ): Promise<{ status: string }> {
    if (this.reversalFailed()) return Promise.reject(providerFailed());
    this.reversals.push({ kind: 'cancel', paymentId, key });
    const payment = this.payments.get(paymentId);
    if (payment)
      this.payments.set(paymentId, { ...payment, status: 'cancelled' });
    return Promise.resolve({ status: 'cancelled' });
  }

  private reversalFailed(): boolean {
    if (this.reversalFailures === 0) return false;
    this.reversalFailures -= 1;
    return true;
  }
}

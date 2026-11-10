import { randomUUID } from 'node:crypto';
import {
  providerFailed,
  type Checkout,
  type CheckoutRequest,
  type PaymentProvider,
  type ProviderAuthorizedPayment,
  type ProviderPayment,
  type ProviderSubscription,
  type SubscriptionRequest,
} from '../src/payments/payment-provider.js';

/** In-memory PaymentProvider (PAY-01): records checkouts and can fail the next call. */
export class FakePaymentProvider implements PaymentProvider {
  readonly checkouts: CheckoutRequest[] = [];
  private failures = 0;

  /** The next `count` provider calls fail with the adapter's 502. */
  failNext(count = 1): void {
    this.failures = count;
  }

  /** Orders by id → the attempt (`external_reference`) they were created for. */
  readonly orders = new Map<string, string>();

  /** Like Mercado Pago with an `X-Idempotency-Key`: the same attempt always gets the same order. */
  createCheckout(request: CheckoutRequest): Promise<Checkout> {
    this.checkouts.push(request);
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(providerFailed());
    }
    const existing = [...this.orders].find(
      ([, reference]) => reference === request.externalReference,
    );
    const checkoutId =
      existing?.[0] ??
      `ORDTST${randomUUID().replaceAll('-', '').toUpperCase()}`;
    this.orders.set(checkoutId, request.externalReference);
    return Promise.resolve({
      checkoutId,
      checkoutUrl: `https://sandbox.mp.test/checkout/${checkoutId}`,
    });
  }

  /** Payments the provider "has", by payment id; they belong to an order by `externalReference`. */
  readonly payments = new Map<string, ProviderPayment>();
  /** Orders whose payments cannot be read (a persistent provider outage), until cleared. */
  readonly unreadable = new Set<string>();
  readonly paymentReads: { tenantId: string; checkoutId: string }[] = [];

  /** The order created for an attempt, for tests that must notify about it. */
  orderOf(externalReference: string): string | undefined {
    return [...this.orders].find(([, ref]) => ref === externalReference)?.[0];
  }

  getPayments(
    tenantId: string,
    checkoutId: string,
  ): Promise<ProviderPayment[]> {
    this.paymentReads.push({ tenantId, checkoutId });
    if (this.unreadable.has(checkoutId))
      return Promise.reject(providerFailed());
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(providerFailed());
    }
    const reference = this.orders.get(checkoutId);
    return reference
      ? Promise.resolve(
          [...this.payments.values()].filter(
            (p) => p.externalReference === reference,
          ),
        )
      : Promise.reject(providerFailed());
  }

  /** One payment by id (the Preferences `payment` notification names the payment). */
  getPayment(tenantId: string, paymentId: string): Promise<ProviderPayment> {
    this.singleReads.push({ tenantId, paymentId });
    const payment = this.payments.get(paymentId);
    return payment
      ? Promise.resolve(payment)
      : Promise.reject(providerFailed());
  }
  readonly singleReads: { tenantId: string; paymentId: string }[] = [];

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
    _checkoutId: string,
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

  /** Cancels the order: its unpaid payments become `cancelled`. */
  cancel(
    _tenantId: string,
    checkoutId: string,
    key: string,
  ): Promise<{ status: string }> {
    if (this.reversalFailed()) return Promise.reject(providerFailed());
    const reference = this.orders.get(checkoutId);
    const open = [...this.payments.values()].filter(
      (p) =>
        p.externalReference === reference &&
        ['pending', 'in_process', 'authorized'].includes(p.status),
    );
    for (const payment of open)
      this.payments.set(payment.id, { ...payment, status: 'cancelled' });
    this.reversals.push({
      kind: 'cancel',
      paymentId: open[0]?.id ?? checkoutId,
      key,
    });
    return Promise.resolve({ status: 'cancelled' });
  }

  /** Preapprovals the provider "has" (EXH-05), by id; tests move them like the payer would. */
  readonly subscriptions = new Map<string, ProviderSubscription>();
  readonly subscriptionRequests: SubscriptionRequest[] = [];
  readonly authorizedPayments = new Map<string, ProviderAuthorizedPayment>();
  readonly cancelledSubscriptions: string[] = [];
  private subscriptionFailures = 0;

  /** The next `count` subscription calls fail with the adapter's 502. */
  failNextSubscription(count = 1): void {
    this.subscriptionFailures = count;
  }

  createSubscription(
    request: SubscriptionRequest,
  ): Promise<ProviderSubscription> {
    this.subscriptionRequests.push(request);
    if (this.subscriptionFailed()) return Promise.reject(providerFailed());
    const id = `preapproval-${randomUUID()}`;
    const subscription: ProviderSubscription = {
      id,
      status: 'pending',
      externalReference: request.externalReference,
      initPoint: `https://sandbox.mp.test/subscriptions/${id}`,
      nextPaymentDate: null,
      payerEmail: request.payerEmail,
    };
    this.subscriptions.set(id, subscription);
    return Promise.resolve(subscription);
  }

  getSubscription(id: string): Promise<ProviderSubscription> {
    const subscription = this.subscriptions.get(id);
    return subscription
      ? Promise.resolve(subscription)
      : Promise.reject(providerFailed());
  }

  /** What the payer or the provider did to the preapproval (authorize, pause, renew). */
  updateSubscription(id: string, change: Partial<ProviderSubscription>): void {
    const current = this.subscriptions.get(id);
    if (!current) throw new Error(`Unknown preapproval ${id}`);
    this.subscriptions.set(id, { ...current, ...change });
  }

  cancelSubscription(id: string): Promise<{ status: string }> {
    if (this.subscriptionFailed()) return Promise.reject(providerFailed());
    this.cancelledSubscriptions.push(id);
    const current = this.subscriptions.get(id);
    if (current)
      this.subscriptions.set(id, { ...current, status: 'cancelled' });
    return Promise.resolve({ status: 'cancelled' });
  }

  getAuthorizedPayment(id: string): Promise<ProviderAuthorizedPayment> {
    const payment = this.authorizedPayments.get(id);
    return payment
      ? Promise.resolve(payment)
      : Promise.reject(providerFailed());
  }

  private subscriptionFailed(): boolean {
    if (this.subscriptionFailures === 0) return false;
    this.subscriptionFailures -= 1;
    return true;
  }

  private reversalFailed(): boolean {
    if (this.reversalFailures === 0) return false;
    this.reversalFailures -= 1;
    return true;
  }
}

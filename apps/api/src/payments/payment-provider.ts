import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';

/** Checkout for one payment attempt; the amount is the server snapshot (INV-05). */
export interface CheckoutRequest {
  readonly tenantId: string;
  /** Payment attempt id, sent as `external_reference` (ADR 0006 §4). */
  readonly externalReference: string;
  readonly title: string;
  readonly amountCents: number;
  readonly currency: string;
  /** ≤ the hold expiry (PAY-02). */
  readonly expiresAt: Date;
  readonly backUrls: {
    readonly success: string;
    readonly pending: string;
    readonly failure: string;
  };
  readonly notificationUrl?: string;
}

export interface Checkout {
  readonly preferenceId: string;
  readonly checkoutUrl: string;
}

/** A payment as the provider reports it server-to-server (§6.7). */
export interface ProviderPayment {
  readonly id: string;
  readonly status: string;
  readonly statusDetail: string | null;
  readonly externalReference: string | null;
  readonly amountCents: number;
  readonly currency: string;
  readonly collectorId: string | null;
  /** Starts the 180-day refund window (PAY-06). */
  readonly approvedAt: Date | null;
}

/** Monthly subscription to the PLATFORM (EXH-05): charged in Juntta's own account, no tenant. */
export interface SubscriptionRequest {
  /** The subscriber's user id (our `platform_subscriptions` row). */
  readonly externalReference: string;
  readonly reason: string;
  /** Mercado Pago validates that the paying account has this email. */
  readonly payerEmail: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly backUrl: string;
  /** Makes a retried create return the same preapproval. */
  readonly idempotencyKey: string;
}

/** A preapproval as the provider reports it: `pending | authorized | paused | cancelled`. */
export interface ProviderSubscription {
  readonly id: string;
  readonly status: string;
  readonly externalReference: string | null;
  readonly initPoint: string | null;
  /** Next charge; the paid period lasts until then. */
  readonly nextPaymentDate: Date | null;
  readonly payerEmail: string | null;
}

/** One charge of a preapproval (`subscription_authorized_payment`). */
export interface ProviderAuthorizedPayment {
  readonly id: string;
  readonly preapprovalId: string | null;
  readonly status: string;
}

/**
 * Payment provider port (PAY-01, ADR 0006). Every payment call names the tenant: each organizer
 * charges in its own seller account (PAY-07). Writes take our own idempotency key. The
 * subscription calls (EXH-05) are platform-level and always use the platform credentials.
 */
export interface PaymentProvider {
  createCheckout(request: CheckoutRequest): Promise<Checkout>;
  getPayment(tenantId: string, paymentId: string): Promise<ProviderPayment>;
  /** Every payment made against one attempt (PAY-05), whether or not it was ever notified. */
  findPayments(
    tenantId: string,
    externalReference: string,
  ): Promise<ProviderPayment[]>;
  refund(
    tenantId: string,
    paymentId: string,
    idempotencyKey: string,
    amountCents?: number,
  ): Promise<{ readonly id: string; readonly status: string }>;
  cancel(
    tenantId: string,
    paymentId: string,
    idempotencyKey: string,
  ): Promise<{ readonly status: string }>;
  createSubscription(
    request: SubscriptionRequest,
  ): Promise<ProviderSubscription>;
  getSubscription(id: string): Promise<ProviderSubscription>;
  /** Irreversible at the provider. */
  cancelSubscription(id: string): Promise<{ readonly status: string }>;
  getAuthorizedPayment(id: string): Promise<ProviderAuthorizedPayment>;
}

export const PAYMENT_PROVIDER = Symbol('PaymentProvider');

/** Payments are not configured for this organization; the rest of the API keeps working (§13.1). */
export const paymentsUnavailable = (): ServiceUnavailableException =>
  new ServiceUnavailableException('Payments are not configured.');

/** The provider failed; its response never reaches the client. */
export const providerFailed = (): BadGatewayException =>
  new BadGatewayException('The payment provider failed. Try again.');

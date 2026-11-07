import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';

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
  readonly backUrls: { readonly success: string; readonly pending: string; readonly failure: string };
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
}

/**
 * Payment provider port (PAY-01, ADR 0006). Every call names the tenant: each organizer
 * charges in its own seller account (PAY-07). Writes take our own idempotency key.
 */
export interface PaymentProvider {
  createCheckout(request: CheckoutRequest): Promise<Checkout>;
  getPayment(tenantId: string, paymentId: string): Promise<ProviderPayment>;
  refund(
    tenantId: string,
    paymentId: string,
    idempotencyKey: string,
    amountCents?: number,
  ): Promise<{ readonly id: string; readonly status: string }>;
  cancel(tenantId: string, paymentId: string, idempotencyKey: string): Promise<{ readonly status: string }>;
}

export const PAYMENT_PROVIDER = Symbol('PaymentProvider');

/** Payments are not configured for this organization; the rest of the API keeps working (§13.1). */
export const paymentsUnavailable = (): ServiceUnavailableException =>
  new ServiceUnavailableException('Payments are not configured.');

/** The provider failed; its response never reaches the client. */
export const providerFailed = (): BadGatewayException =>
  new BadGatewayException('The payment provider failed. Try again.');

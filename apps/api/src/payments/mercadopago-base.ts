import { HttpException, Logger } from '@nestjs/common';
import { MercadoPagoConfig, MercadoPagoError, PreApproval } from 'mercadopago';
import {
  paymentsUnavailable,
  providerFailed,
  type Checkout,
  type CheckoutRequest,
  type PaymentProvider,
  type ProviderAuthorizedPayment,
  type ProviderPayment,
  type ProviderSubscription,
  type SubscriptionRequest,
} from './payment-provider.js';

export interface MercadoPagoSettings {
  readonly environment: 'sandbox' | 'production';
  readonly accessToken: string | undefined;
}

export const TIMEOUT_MS = 10_000;
const API_URL = 'https://api.mercadopago.com';
/** GETs and keyed writes retry; the SDK default is 3. */
export const RETRIES = 2;

export const toUnits = (cents: number): number => cents / 100;

/** Fields shared by `GET /preapproval/{id}` and the create/update responses. */
interface RawPreapproval {
  readonly id?: string;
  readonly status?: string;
  readonly external_reference?: string;
  readonly init_point?: string;
  readonly next_payment_date?: string;
  readonly payer_email?: string;
}

const toSubscription = (p: RawPreapproval): ProviderSubscription => {
  const next = p.next_payment_date ? new Date(p.next_payment_date) : null;
  return {
    id: String(p.id),
    status: p.status ?? 'unknown',
    externalReference: p.external_reference ?? null,
    initPoint: p.init_point ?? null,
    nextPaymentDate: next && !Number.isNaN(next.getTime()) ? next : null,
    payerEmail: p.payer_email ?? null,
  };
};

/**
 * What both Checkout Pro adapters (Preferences and Orders, ADR 0007) share: credentials per
 * tenant, error mapping and the platform subscription calls (EXH-05), which never depend on
 * the checkout API.
 * A fresh SDK config per call: the SDK merges `requestOptions` into the shared config, so a
 * reused one would leak an idempotency key or `maxRetries: 0` into the next call.
 */
export abstract class MercadoPagoBase implements PaymentProvider {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    protected readonly settings: MercadoPagoSettings,
    /** The tenant's linked seller access token, or null when it has none (PAY-07). */
    private readonly sellerToken?: (tenantId: string) => Promise<string | null>,
  ) {}

  abstract createCheckout(request: CheckoutRequest): Promise<Checkout>;
  abstract getPayments(
    tenantId: string,
    checkoutId: string,
  ): Promise<ProviderPayment[]>;
  abstract getPayment(
    tenantId: string,
    paymentId: string,
  ): Promise<ProviderPayment>;
  abstract refund(
    tenantId: string,
    checkoutId: string,
    paymentId: string,
    idempotencyKey: string,
    amountCents?: number,
  ): Promise<{ id: string; status: string }>;
  abstract cancel(
    tenantId: string,
    checkoutId: string,
    idempotencyKey: string,
  ): Promise<{ status: string }>;

  /**
   * EXH-05: a preapproval WITHOUT plan, charged in the platform's account (never a seller's).
   * The payer authorizes it at `init_point`; the webhook then reports the outcome.
   */
  createSubscription(
    request: SubscriptionRequest,
  ): Promise<ProviderSubscription> {
    return this.platformCall('createSubscription', async (config) => {
      const created = await new PreApproval(config).create({
        body: {
          reason: request.reason,
          external_reference: request.externalReference,
          payer_email: request.payerEmail,
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: toUnits(request.amountCents),
            currency_id: request.currency,
          },
          back_url: request.backUrl,
          status: 'pending',
        },
        requestOptions: {
          idempotencyKey: request.idempotencyKey,
          maxRetries: RETRIES,
        },
      });
      if (!created.id || !created.init_point) throw providerFailed();
      return toSubscription(created);
    });
  }

  getSubscription(id: string): Promise<ProviderSubscription> {
    return this.platformCall('getSubscription', async (config) =>
      toSubscription(
        await new PreApproval(config).get({
          id,
          requestOptions: { maxRetries: RETRIES },
        }),
      ),
    );
  }

  cancelSubscription(id: string): Promise<{ status: string }> {
    return this.platformCall('cancelSubscription', async (config) => {
      const updated = await new PreApproval(config).update({
        id,
        body: { status: 'cancelled' },
        requestOptions: { maxRetries: RETRIES },
      });
      return { status: updated.status ?? 'unknown' };
    });
  }

  /** The SDK has no client for `/authorized_payments`: plain `fetch`, response never logged. */
  async getAuthorizedPayment(id: string): Promise<ProviderAuthorizedPayment> {
    const token = this.settings.accessToken;
    if (!token) throw paymentsUnavailable();
    try {
      const response = await fetch(
        `${API_URL}/authorized_payments/${encodeURIComponent(id)}`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        id?: string | number;
        preapproval_id?: string | number;
        status?: string;
      };
      if (!response.ok || body.id === undefined) {
        this.logger.warn(
          `Mercado Pago getAuthorizedPayment failed (${response.status})`,
        );
        throw providerFailed();
      }
      return {
        id: String(body.id),
        preapprovalId:
          body.preapproval_id === undefined
            ? null
            : String(body.preapproval_id),
        status: body.status ?? 'unknown',
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn('Mercado Pago getAuthorizedPayment failed (network)');
      throw providerFailed();
    }
  }

  /** Platform-level call (EXH-05): the platform token in every environment, 503 without one. */
  private async platformCall<T>(
    operation: string,
    run: (config: MercadoPagoConfig) => Promise<T>,
  ): Promise<T> {
    const token = this.settings.accessToken;
    if (!token) throw paymentsUnavailable();
    try {
      return await run(
        new MercadoPagoConfig({
          accessToken: token,
          options: { timeout: TIMEOUT_MS },
        }),
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const status =
        error instanceof MercadoPagoError ? error.status : 'network';
      this.logger.warn(`Mercado Pago ${operation} failed (${status})`);
      throw providerFailed();
    }
  }

  /** Resolves the seller credentials and maps provider failures to a 502 without its body. */
  protected async call<T>(
    operation: string,
    tenantId: string,
    run: (config: MercadoPagoConfig) => Promise<T>,
  ): Promise<T> {
    const config = await this.configFor(tenantId);
    try {
      return await run(config);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Only the operation and status: the provider body may echo request data.
      const status =
        error instanceof MercadoPagoError ? error.status : 'network';
      this.logger.warn(
        `Mercado Pago ${operation} failed (${status}) for tenant ${tenantId}`,
      );
      throw providerFailed();
    }
  }

  /**
   * The organizer's OAuth-linked seller token (PAY-07, ADR 0006 §2). Without one, sandbox falls
   * back to the platform token for development; production refuses (never charge as Juntta).
   */
  private async configFor(tenantId: string): Promise<MercadoPagoConfig> {
    const { accessToken, environment } = this.settings;
    const linked = await this.sellerToken?.(tenantId);
    const token =
      linked ?? (environment === 'sandbox' ? accessToken : undefined);
    if (!token) throw paymentsUnavailable();
    return new MercadoPagoConfig({
      accessToken: token,
      options: { timeout: TIMEOUT_MS },
    });
  }
}

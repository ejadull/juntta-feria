import { HttpException, Logger } from '@nestjs/common';
import {
  MercadoPagoConfig,
  MercadoPagoError,
  Payment,
  PaymentRefund,
  Preference,
} from 'mercadopago';
import {
  paymentsUnavailable,
  providerFailed,
  type Checkout,
  type CheckoutRequest,
  type PaymentProvider,
  type ProviderPayment,
} from './payment-provider.js';

export interface MercadoPagoSettings {
  readonly environment: 'sandbox' | 'production';
  readonly accessToken: string | undefined;
}

const TIMEOUT_MS = 10_000;
/** GETs and keyed writes retry; the SDK default is 3. */
const RETRIES = 2;

const toUnits = (cents: number): number => cents / 100;
const toCents = (units: number | undefined): number => Math.round((units ?? 0) * 100);
/** Mercado Pago wants ISO 8601 with an explicit offset. */
const withOffset = (date: Date): string => date.toISOString().replace('Z', '+00:00');

/**
 * Mercado Pago adapter (PAY-01, ADR 0006) over the official SDK.
 * A fresh SDK config per call: the SDK merges `requestOptions` into the shared config, so a
 * reused one would leak an idempotency key or `maxRetries: 0` into the next call.
 */
export class MercadoPagoProvider implements PaymentProvider {
  private readonly logger = new Logger(MercadoPagoProvider.name);

  constructor(private readonly settings: MercadoPagoSettings) {}

  createCheckout(request: CheckoutRequest): Promise<Checkout> {
    return this.call('createCheckout', request.tenantId, async (config) => {
      const preference = await new Preference(config).create({
        body: {
          items: [
            {
              id: request.externalReference,
              title: request.title,
              quantity: 1,
              unit_price: toUnits(request.amountCents),
              currency_id: request.currency,
            },
          ],
          external_reference: request.externalReference,
          ...(request.notificationUrl ? { notification_url: request.notificationUrl } : {}),
          back_urls: request.backUrls,
          auto_return: 'approved',
          binary_mode: false,
          expires: true,
          expiration_date_to: withOffset(request.expiresAt),
        },
        // Preferences has no idempotency key: a retry could create a second preference.
        requestOptions: { maxRetries: 0 },
      });
      const checkoutUrl =
        this.settings.environment === 'sandbox' ? preference.sandbox_init_point : preference.init_point;
      if (!preference.id || !checkoutUrl) throw providerFailed();
      return { preferenceId: preference.id, checkoutUrl };
    });
  }

  getPayment(tenantId: string, paymentId: string): Promise<ProviderPayment> {
    return this.call('getPayment', tenantId, async (config) => {
      const p = await new Payment(config).get({ id: paymentId, requestOptions: { maxRetries: RETRIES } });
      return {
        id: String(p.id),
        status: p.status ?? 'unknown',
        statusDetail: p.status_detail ?? null,
        externalReference: p.external_reference ?? null,
        amountCents: toCents(p.transaction_amount),
        currency: p.currency_id ?? '',
        collectorId: p.collector_id === undefined ? null : String(p.collector_id),
      };
    });
  }

  refund(
    tenantId: string,
    paymentId: string,
    idempotencyKey: string,
    amountCents?: number,
  ): Promise<{ id: string; status: string }> {
    return this.call('refund', tenantId, async (config) => {
      const refund = await new PaymentRefund(config).create({
        payment_id: paymentId,
        ...(amountCents === undefined ? {} : { body: { amount: toUnits(amountCents) } }),
        requestOptions: { idempotencyKey, maxRetries: RETRIES },
      });
      return { id: String(refund.id), status: refund.status ?? 'unknown' };
    });
  }

  cancel(tenantId: string, paymentId: string, idempotencyKey: string): Promise<{ status: string }> {
    return this.call('cancel', tenantId, async (config) => {
      const payment = await new Payment(config).cancel({
        id: paymentId,
        requestOptions: { idempotencyKey, maxRetries: RETRIES },
      });
      return { status: payment.status ?? 'unknown' };
    });
  }

  /** Resolves the seller credentials and maps provider failures to a 502 without its body. */
  private async call<T>(
    operation: string,
    tenantId: string,
    run: (config: MercadoPagoConfig) => Promise<T>,
  ): Promise<T> {
    const config = this.configFor(tenantId);
    try {
      return await run(config);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Only the operation and status: the provider body may echo request data.
      const status = error instanceof MercadoPagoError ? error.status : 'network';
      this.logger.warn(`Mercado Pago ${operation} failed (${status}) for tenant ${tenantId}`);
      throw providerFailed();
    }
  }

  /**
   * ponytail: one platform token for every tenant, sandbox only. Production needs each
   * organizer's OAuth-linked seller account (PAY-07, ADR 0006 §2); until then it refuses.
   */
  private configFor(_tenantId: string): MercadoPagoConfig {
    const { accessToken, environment } = this.settings;
    if (!accessToken || environment !== 'sandbox') throw paymentsUnavailable();
    return new MercadoPagoConfig({ accessToken, options: { timeout: TIMEOUT_MS } });
  }
}

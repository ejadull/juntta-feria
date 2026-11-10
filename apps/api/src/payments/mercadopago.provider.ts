import { HttpException, Logger } from '@nestjs/common';
import {
  MercadoPagoConfig,
  MercadoPagoError,
  Order,
  PreApproval,
} from 'mercadopago';
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

const TIMEOUT_MS = 10_000;
const API_URL = 'https://api.mercadopago.com';
/** GETs and keyed writes retry; the SDK default is 3. */
const RETRIES = 2;

const toUnits = (cents: number): number => cents / 100;
type OrderResponse = Awaited<ReturnType<Order['get']>>;
/** Orders speak decimal strings ("45000.50"), never floats. */
const toAmount = (cents: number): string => (cents / 100).toFixed(2);
const toCents = (amount: string | undefined): number =>
  Math.round(Number(amount ?? 0) * 100);

/**
 * Orders (ADR 0007) report `created | processed | action_required | failed | processing |
 * canceled | refunded | expired`; the rest of the API keeps one payment vocabulary.
 * Anything unknown is `pending`, never `approved`.
 */
const PAYMENT_STATUS: Readonly<Record<string, string>> = {
  processed: 'approved',
  approved: 'approved',
  refunded: 'refunded',
  charged_back: 'charged_back',
  failed: 'rejected',
  rejected: 'rejected',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  expired: 'cancelled',
  processing: 'in_process',
  in_process: 'in_process',
};
const PAID: readonly string[] = ['approved', 'refunded', 'charged_back'];

/** ISO 8601 duration (`PT14M30S`): the order lives as long as the hold, never longer. */
export const toDuration = (from: Date, until: Date): string => {
  const total = Math.max(
    1,
    Math.floor((until.getTime() - from.getTime()) / 1000),
  );
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const h = hours ? `${hours}H` : '';
  const m = minutes ? `${minutes}M` : '';
  const sec = seconds || !(hours || minutes) ? `${seconds}S` : '';
  return `PT${h}${m}${sec}`;
};

/** The payments of an order, in the port's vocabulary. */
export const toPayments = (
  order: Omit<OrderResponse, 'api_response'>,
): ProviderPayment[] => {
  const created = order.created_date ? new Date(order.created_date) : null;
  return (order.transactions?.payments ?? []).map((p) => {
    const status = PAYMENT_STATUS[p.status ?? ''] ?? 'pending';
    return {
      id: String(p.id),
      status,
      statusDetail: p.status_detail ?? null,
      externalReference: order.external_reference ?? null,
      amountCents: toCents(p.amount),
      currency: order.currency ?? '',
      collectorId: order.user_id === undefined ? null : String(order.user_id),
      // Payments land inside the hold window, so the order creation is a stable stand-in.
      approvedAt: PAID.includes(status) ? created : null,
    };
  });
};

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
 * Mercado Pago adapter (PAY-01, ADR 0006) over the official SDK.
 * A fresh SDK config per call: the SDK merges `requestOptions` into the shared config, so a
 * reused one would leak an idempotency key or `maxRetries: 0` into the next call.
 */
export class MercadoPagoProvider implements PaymentProvider {
  private readonly logger = new Logger(MercadoPagoProvider.name);

  constructor(
    private readonly settings: MercadoPagoSettings,
    /** The tenant's linked seller access token, or null when it has none (PAY-07). */
    private readonly sellerToken?: (tenantId: string) => Promise<string | null>,
  ) {}

  createCheckout(request: CheckoutRequest): Promise<Checkout> {
    return this.call('createCheckout', request.tenantId, async (config) => {
      const amount = toAmount(request.amountCents);
      const { payer } = request;
      const order = await new Order(config).create({
        body: {
          type: 'online',
          processing_mode: 'manual',
          total_amount: amount,
          currency: request.currency,
          external_reference: request.externalReference,
          description: request.title,
          items: [
            {
              title: request.title,
              unit_price: amount,
              quantity: 1,
              external_code: request.externalReference,
            },
          ],
          payer: {
            email: payer.email,
            ...(payer.firstName ? { first_name: payer.firstName } : {}),
            ...(payer.lastName ? { last_name: payer.lastName } : {}),
          },
          expiration_time: toDuration(new Date(), request.expiresAt),
          config: {
            online: {
              success_url: request.backUrls.success,
              pending_url: request.backUrls.pending,
              failure_url: request.backUrls.failure,
              // Mercado Pago rejects auto_return with non-https URLs (localhost) in Preferences;
              // the same guard stays until the Orders sandbox shows otherwise.
              ...(request.backUrls.success.startsWith('https://')
                ? { auto_return: 'approved' as const }
                : {}),
              // A rejected card does not end the order: P19 "Reintentar el pago" reuses it.
              retries: { allowed: true },
            },
          },
        },
        // The attempt id is the idempotency key: a retried create returns the same order.
        requestOptions: {
          idempotencyKey: request.externalReference,
          maxRetries: RETRIES,
        },
      });
      if (!order.id || !order.checkout_url) throw providerFailed();
      return { checkoutId: order.id, checkoutUrl: order.checkout_url };
    });
  }

  getPayments(
    tenantId: string,
    checkoutId: string,
  ): Promise<ProviderPayment[]> {
    return this.call('getPayments', tenantId, async (config) =>
      toPayments(
        await new Order(config).get({
          id: checkoutId,
          requestOptions: { maxRetries: RETRIES },
        }),
      ),
    );
  }

  /** Total refund without a body; partial with the payment transaction and the amount. */
  refund(
    tenantId: string,
    checkoutId: string,
    paymentId: string,
    idempotencyKey: string,
    amountCents?: number,
  ): Promise<{ id: string; status: string }> {
    return this.call('refund', tenantId, async (config) => {
      const order = await new Order(config).refund({
        id: checkoutId,
        ...(amountCents === undefined
          ? {}
          : {
              body: {
                transactions: [
                  { id: paymentId, amount: toAmount(amountCents) },
                ],
              },
            }),
        requestOptions: { idempotencyKey, maxRetries: RETRIES },
      });
      const refund = order.transactions?.refunds?.at(-1);
      return {
        id: String(refund?.id ?? checkoutId),
        status: refund?.status ?? order.status ?? 'unknown',
      };
    });
  }

  /** Orders only cancel while `created` or `action_required`; an already canceled one is a success. */
  cancel(
    tenantId: string,
    checkoutId: string,
    idempotencyKey: string,
  ): Promise<{ status: string }> {
    return this.call('cancel', tenantId, async (config) => {
      const orders = new Order(config);
      try {
        const order = await orders.cancel({
          id: checkoutId,
          requestOptions: { idempotencyKey, maxRetries: RETRIES },
        });
        return { status: PAYMENT_STATUS[order.status ?? ''] ?? 'unknown' };
      } catch (error) {
        if (!(error instanceof MercadoPagoError) || error.status !== 409)
          throw error;
        // 409 order_already_canceled (a replay or a concurrent cancel): confirm, never assume.
        const order = await orders.get({
          id: checkoutId,
          requestOptions: { maxRetries: RETRIES },
        });
        if (PAYMENT_STATUS[order.status ?? ''] !== 'cancelled') throw error;
        return { status: 'cancelled' };
      }
    });
  }

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
  private async call<T>(
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

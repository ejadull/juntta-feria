import { MercadoPagoError, Order } from 'mercadopago';
import {
  providerFailed,
  type Checkout,
  type CheckoutRequest,
  type ProviderPayment,
} from './payment-provider.js';
import { RETRIES, MercadoPagoBase } from './mercadopago-base.js';

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

/**
 * Mercado Pago adapter over the Orders API (PAY-01, ADR 0007). Optional since the 2026-11-10
 * amendment: select it with `MP_CHECKOUT_API=orders`.
 */
export class MercadoPagoOrdersProvider extends MercadoPagoBase {
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

  /**
   * Orders notify the ORDER (topic `order`); a single payment cannot be read on its own.
   * The `payment` topic belongs to the Preferences adapter.
   */
  getPayment(): Promise<ProviderPayment> {
    return Promise.reject(providerFailed());
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
}

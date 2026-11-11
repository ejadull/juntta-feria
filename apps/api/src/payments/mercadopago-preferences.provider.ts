import { Payment, PaymentRefund, Preference } from 'mercadopago';
import {
  providerFailed,
  type Checkout,
  type CheckoutRequest,
  type ProviderPayment,
} from './payment-provider.js';
import { RETRIES, MercadoPagoBase, toUnits } from './mercadopago-base.js';

const toCents = (units: number | undefined): number =>
  Math.round((units ?? 0) * 100);

/** Payments still waiting for the buyer or the bank: the only ones a cancel can stop. */
const CANCELLABLE: readonly string[] = ['pending', 'in_process', 'authorized'];

/** Fields shared by `GET /v1/payments/{id}` and the search results. */
interface RawPayment {
  readonly id?: string | number;
  readonly status?: string;
  readonly status_detail?: string;
  readonly external_reference?: string;
  readonly transaction_amount?: number;
  readonly currency_id?: string;
  readonly collector_id?: string | number;
  readonly date_approved?: string;
}

/** Payments already speak the port's vocabulary (approved, pending, rejected, refunded...). */
export const toPayment = (p: RawPayment): ProviderPayment => ({
  id: String(p.id),
  status: p.status ?? 'unknown',
  statusDetail: p.status_detail ?? null,
  externalReference: p.external_reference ?? null,
  amountCents: toCents(p.transaction_amount),
  currency: p.currency_id ?? '',
  collectorId: p.collector_id === undefined ? null : String(p.collector_id),
  approvedAt: p.date_approved ? new Date(p.date_approved) : null,
});

/** Mercado Pago wants ISO 8601 with an explicit offset. */
const withOffset = (date: Date): string =>
  date.toISOString().replace('Z', '+00:00');

/**
 * Mercado Pago adapter over the Preferences API (PAY-01, ADR 0006): the default Checkout Pro
 * integration since the 2026-11-10 amendment of ADR 0007. `checkoutId` is the preference id;
 * its payments are the ones carrying the preference's `external_reference` (our attempt id).
 */
export class MercadoPagoPreferencesProvider extends MercadoPagoBase {
  createCheckout(request: CheckoutRequest): Promise<Checkout> {
    return this.call('createCheckout', request.tenantId, async (config) => {
      const { payer } = request;
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
          payer: {
            email: payer.email,
            ...(payer.firstName ? { name: payer.firstName } : {}),
            ...(payer.lastName ? { surname: payer.lastName } : {}),
          },
          external_reference: request.externalReference,
          ...(request.notificationUrl
            ? { notification_url: request.notificationUrl }
            : {}),
          back_urls: request.backUrls,
          // Mercado Pago rejects auto_return with non-https back_urls (localhost): 400 invalid_auto_return.
          ...(request.backUrls.success.startsWith('https://')
            ? { auto_return: 'approved' }
            : {}),
          binary_mode: false,
          expires: true,
          expiration_date_to: withOffset(request.expiresAt),
        },
        // Preferences has no idempotency key: a retry could create a second preference.
        requestOptions: { maxRetries: 0 },
      });
      const checkoutUrl =
        this.settings.environment === 'sandbox'
          ? preference.sandbox_init_point
          : preference.init_point;
      if (!preference.id || !checkoutUrl) throw providerFailed();
      return { checkoutId: preference.id, checkoutUrl };
    });
  }

  /**
   * A preference lists no payments: search the ones carrying its `external_reference`, which is
   * our attempt id. The preference itself is never read (`GET /checkout/preferences/:id` answers
   * 403 to the platform credentials).
   */
  getPayments(
    tenantId: string,
    _checkoutId: string,
    attemptId?: string,
  ): Promise<ProviderPayment[]> {
    if (!attemptId) return Promise.reject(providerFailed());
    return this.call('getPayments', tenantId, (config) =>
      this.searchByReference(config, attemptId),
    );
  }

  private async searchByReference(
    config: ConstructorParameters<typeof Payment>[0],
    attemptId: string,
  ): Promise<ProviderPayment[]> {
    const found = await new Payment(config).search({
      options: { external_reference: attemptId },
      requestOptions: { maxRetries: RETRIES },
    });
    return (found.results ?? []).map(toPayment);
  }

  getPayment(tenantId: string, paymentId: string): Promise<ProviderPayment> {
    return this.call('getPayment', tenantId, async (config) =>
      toPayment(
        await new Payment(config).get({
          id: paymentId,
          requestOptions: { maxRetries: RETRIES },
        }),
      ),
    );
  }

  /** The refund names the payment; the preference id is not needed. */
  refund(
    tenantId: string,
    _checkoutId: string,
    paymentId: string,
    idempotencyKey: string,
    amountCents?: number,
  ): Promise<{ id: string; status: string }> {
    return this.call('refund', tenantId, async (config) => {
      const refund = await new PaymentRefund(config).create({
        payment_id: paymentId,
        ...(amountCents === undefined
          ? {}
          : { body: { amount: toUnits(amountCents) } }),
        requestOptions: { idempotencyKey, maxRetries: RETRIES },
      });
      return { id: String(refund.id), status: refund.status ?? 'unknown' };
    });
  }

  /**
   * A preference cannot be cancelled, its unpaid payments can: each pending payment of the
   * preference is cancelled with a key derived from ours. Nothing left to cancel counts as
   * cancelled (a replay, or the buyer's attempt already ended).
   */
  cancel(
    tenantId: string,
    _checkoutId: string,
    attemptId: string,
    idempotencyKey: string,
  ): Promise<{ status: string }> {
    return this.call('cancel', tenantId, async (config) => {
      for (const payment of await this.searchByReference(config, attemptId)) {
        if (!CANCELLABLE.includes(payment.status)) continue;
        const cancelled = await new Payment(config).cancel({
          id: payment.id,
          requestOptions: {
            idempotencyKey: `${idempotencyKey}:${payment.id}`,
            maxRetries: RETRIES,
          },
        });
        if (cancelled.status !== 'cancelled') return { status: 'unknown' };
      }
      return { status: 'cancelled' };
    });
  }
}

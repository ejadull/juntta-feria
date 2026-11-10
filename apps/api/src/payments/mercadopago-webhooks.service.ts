import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  InvalidWebhookSignatureError,
  WebhookSignatureValidator,
} from 'mercadopago';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import {
  DatabaseService,
  isUuid,
  type Transaction,
} from '../db/database.service.js';
import {
  eventStands,
  paymentAttempts,
  paymentWebhookInbox,
  reservations,
  sellerAccounts,
  type WebhookInboxStatus,
} from '../db/schema.js';
import { AuditService } from '../tenancy/audit.service.js';
import {
  PAYMENT_PROVIDER,
  paymentsUnavailable,
  type PaymentProvider,
  type ProviderPayment,
} from './payment-provider.js';
import {
  PlatformSubscriptionsService,
  SUBSCRIPTION_TOPICS,
} from './platform-subscriptions.service.js';

export interface Notification {
  readonly signature: string | undefined;
  readonly requestId: string | undefined;
  readonly dataId: string;
  readonly topic: string;
}

/** Orders notifications: `type=order` on the Checkout Pro page, topic `orders` in the panel. */
const ORDER_TOPICS: readonly string[] = ['order', 'orders'];

/** States that still own the stand and can be confirmed (§4.5). */
const CONFIRMABLE: readonly string[] = ['HELD', 'PAYMENT_PENDING'];
/** Statuses an approved payment can still move to (PAY-06). */
const REVERSED: readonly string[] = ['refunded', 'charged_back'];

/**
 * Mercado Pago webhooks (PAY-03, §6.7, ADR 0006 §3). `receive` authenticates and stores the
 * notification fast (< 22 s); `process` re-reads the payment server-to-server and applies it.
 * Effects are idempotent and monotonic: an approved attempt is never reverted by a later event.
 */
@Injectable()
export class MercadoPagoWebhooksService {
  private readonly logger = new Logger(MercadoPagoWebhooksService.name);
  private readonly secret: string | undefined;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly subscriptions: PlatformSubscriptionsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(configuration.KEY) env: AppConfiguration,
  ) {
    this.secret = env.mercadoPago.webhookSecret;
  }

  /** Returns the inbox id to process, or null for a duplicate or an ignored notification. */
  async receive(notification: Notification): Promise<string | null> {
    if (!this.secret) throw paymentsUnavailable();
    const { signature, requestId, dataId, topic } = notification;
    if (!requestId)
      throw new UnauthorizedException('Invalid webhook signature.');
    this.verify(signature, requestId, dataId);
    this.logDrift(requestId, signature);

    // Orders and subscriptions come from the one URL set in the Mercado Pago panel, which cannot
    // carry a tenant: `process` finds the tenant of an order from our own stored order id.
    const ignored =
      SUBSCRIPTION_TOPICS.includes(topic) || ORDER_TOPICS.includes(topic)
        ? null
        : 'UNSUPPORTED_TOPIC';
    const [row] = await this.database.db
      .insert(paymentWebhookInbox)
      .values({
        requestId,
        topic,
        dataId,
        status: ignored ? 'IGNORED' : 'RECEIVED',
        outcome: ignored,
        processedAt: ignored ? new Date() : null,
      })
      .onConflictDoNothing({ target: paymentWebhookInbox.requestId })
      .returning({ id: paymentWebhookInbox.id });
    return row && !ignored ? row.id : null;
  }

  /**
   * Never throws: a failure is recorded as FAILED for the reconciliation job (PAY-05).
   * ponytail: in-process after the 200; move to a BullMQ queue if webhooks must survive restarts
   * before PAY-05 picks them up.
   */
  async process(inboxId: string): Promise<void> {
    try {
      const [entry] = await this.database.db
        .select()
        .from(paymentWebhookInbox)
        .where(eq(paymentWebhookInbox.id, inboxId));
      if (entry?.status !== 'RECEIVED') return;
      if (SUBSCRIPTION_TOPICS.includes(entry.topic))
        return await this.processSubscription(inboxId, entry);
      await this.processOrder(inboxId, entry.dataId);
    } catch (error) {
      this.logger.error(
        `Mercado Pago webhook ${inboxId} failed`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.finish(inboxId, 'FAILED', 'INTERNAL_ERROR').catch(
        () => undefined,
      );
    }
  }

  /**
   * PAY-03: the notification only names the order. Its tenant comes from OUR attempt (an unknown
   * order is somebody else's); its payments are re-read with that tenant's seller credentials.
   */
  private async processOrder(inboxId: string, orderId: string): Promise<void> {
    const tenantId = await this.tenantOf(orderId);
    if (!tenantId)
      return await this.finish(inboxId, 'IGNORED', 'UNKNOWN_ORDER');
    await this.database.db
      .update(paymentWebhookInbox)
      .set({ tenantId })
      .where(eq(paymentWebhookInbox.id, inboxId));
    let payments: ProviderPayment[];
    try {
      payments = await this.provider.getPayments(tenantId, orderId);
    } catch {
      return await this.finish(inboxId, 'FAILED', 'PROVIDER_ERROR');
    }
    // An order with no payment yet (created, expired, canceled) changes nothing.
    if (payments.length === 0)
      return await this.finish(inboxId, 'PROCESSED', 'NO_PAYMENT');
    const outcomes: string[] = [];
    for (const payment of payments)
      outcomes.push(await this.applyPayment(tenantId, payment));
    const outcome = outcomes.includes('CONFIRMED')
      ? 'CONFIRMED'
      : (outcomes.at(-1) ?? 'NO_PAYMENT');
    await this.finish(
      inboxId,
      outcomes.every((o) => o === 'UNKNOWN_ATTEMPT') ? 'IGNORED' : 'PROCESSED',
      outcome,
    );
  }

  /** The only cross-tenant read: RLS hides attempts until the tenant is known (migration 0016). */
  private async tenantOf(orderId: string): Promise<string | null> {
    const { rows } = await this.database.db.execute<{
      tenant_id: string | null;
    }>(sql`SELECT payment_attempt_tenant(${orderId}) AS tenant_id`);
    const tenantId = rows[0]?.tenant_id;
    return isUuid(tenantId) ? tenantId : null;
  }

  /**
   * Mercado Pago signs `id:<data.id>`; for alphanumeric ids (order ULIDs) its documented
   * convention is lowercase, so the id as received is tried first and then lowercased.
   */
  private verify(
    signature: string | undefined,
    requestId: string,
    dataId: string,
  ): void {
    const validate = (id: string) =>
      WebhookSignatureValidator.validate({
        xSignature: signature,
        xRequestId: requestId,
        dataId: id,
        secret: this.secret ?? '',
      });
    try {
      try {
        validate(dataId);
      } catch (error) {
        if (
          !(error instanceof InvalidWebhookSignatureError) ||
          dataId === dataId.toLowerCase()
        )
          throw error;
        validate(dataId.toLowerCase());
      }
    } catch (error) {
      if (!(error instanceof InvalidWebhookSignatureError)) throw error;
      this.logger.warn(
        `Rejected Mercado Pago webhook ${requestId}: ${error.reason}`,
      );
      throw new UnauthorizedException('Invalid webhook signature.');
    }
  }

  /** EXH-05: the notification only names the preapproval; its state is re-read from Mercado Pago. */
  private async processSubscription(
    inboxId: string,
    entry: { topic: string; dataId: string },
  ): Promise<void> {
    let outcome: string;
    try {
      outcome = await this.subscriptions.sync(entry.topic, entry.dataId);
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      return await this.finish(inboxId, 'FAILED', 'PROVIDER_ERROR');
    }
    await this.finish(
      inboxId,
      outcome === 'UNKNOWN_SUBSCRIPTION'
        ? 'IGNORED'
        : outcome === 'MISSING_PERIOD'
          ? 'FAILED'
          : 'PROCESSED',
      outcome,
    );
  }

  /**
   * Applies a payment read server-to-server (webhook or reconciliation) and returns the outcome
   * (CONFIRMED, ALREADY_APPROVED, AMOUNT_MISMATCH, LATE_PAYMENT_CONFLICT, UNKNOWN_ATTEMPT, PAYMENT_<status>).
   */
  applyPayment(tenantId: string, payment: ProviderPayment): Promise<string> {
    return this.database.withTenant(tenantId, (tx) => this.apply(tx, payment));
  }

  /** §6.7: match reference, amount and currency; confirm under lock; record every outcome. */
  private async apply(
    tx: Transaction,
    payment: ProviderPayment,
  ): Promise<string> {
    if (!isUuid(payment.externalReference)) return 'UNKNOWN_ATTEMPT';
    const [attempt] = await tx
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, payment.externalReference))
      .for('update');
    if (!attempt) return 'UNKNOWN_ATTEMPT';
    // §6.7, PAY-07: the money must land in the organizer's linked seller account.
    const [seller] = await tx
      .select({ id: sellerAccounts.sellerId })
      .from(sellerAccounts);
    if (seller && payment.collectorId !== seller.id) {
      this.logger.warn(
        `Payment ${payment.id} was not collected by the linked seller`,
      );
      await this.audit.record(tx, {
        actorId: null,
        action: 'payment.collector_mismatch',
        entityType: 'payment_attempt',
        entityId: attempt.id,
        after: {
          paymentId: payment.id,
          collectorId: payment.collectorId,
          sellerId: seller.id,
        },
      });
      return 'COLLECTOR_MISMATCH';
    }
    if (
      payment.amountCents !== attempt.amountCents ||
      payment.currency !== attempt.currency
    ) {
      this.logger.warn(
        `Payment ${payment.id} does not match attempt ${attempt.id}`,
      );
      await this.audit.record(tx, {
        actorId: null,
        action: 'payment.mismatch',
        entityType: 'payment_attempt',
        entityId: attempt.id,
        after: {
          paymentId: payment.id,
          amountCents: payment.amountCents,
          currency: payment.currency,
        },
      });
      return 'AMOUNT_MISMATCH';
    }
    // Monotonic: an approved attempt only records reversals (PAY-06); older events change nothing.
    if (attempt.status === 'APPROVED')
      return this.reverse(tx, attempt, payment);

    const approved = payment.status === 'approved';
    await tx
      .update(paymentAttempts)
      .set({
        paymentId: payment.id,
        paymentStatus: payment.status,
        ...(approved ? { status: 'APPROVED' as const } : {}),
        updatedAt: new Date(),
      })
      .where(eq(paymentAttempts.id, attempt.id));
    // pending / in_process / rejected / cancelled: the order stays payable (retries allowed) until it expires.
    if (!approved) return `PAYMENT_${payment.status.toUpperCase()}`;
    return this.confirm(tx, attempt.reservationId, payment.id);
  }

  /**
   * PAY-06: `refunded` (ours or from the seller panel) is only recorded; `charged_back` is an
   * incident for a human (CHARGEBACK), since the buyer's bank took the money back.
   * ponytail: the `chargebacks` topic (GET /v1/chargebacks/{id}) is not subscribed; the payment
   * topic already reports the status change. Subscribe it when dispute details are needed.
   */
  private async reverse(
    tx: Transaction,
    attempt: typeof paymentAttempts.$inferSelect,
    payment: ProviderPayment,
  ): Promise<string> {
    const seen =
      payment.id === attempt.paymentId &&
      payment.status === attempt.paymentStatus;
    if (!REVERSED.includes(payment.status) || seen) return 'ALREADY_APPROVED';
    if (payment.id === attempt.paymentId)
      await tx
        .update(paymentAttempts)
        .set({ paymentStatus: payment.status, updatedAt: new Date() })
        .where(eq(paymentAttempts.id, attempt.id));
    if (payment.status === 'charged_back')
      await this.audit.record(tx, {
        actorId: null,
        action: 'payment.charged_back',
        entityType: 'reservation',
        entityId: attempt.reservationId,
        after: {
          code: 'CHARGEBACK',
          paymentId: payment.id,
          statusDetail: payment.statusDetail,
        },
      });
    return `PAYMENT_${payment.status.toUpperCase()}`;
  }

  private async confirm(
    tx: Transaction,
    reservationId: string,
    paymentId: string,
  ): Promise<string> {
    const [reservation] = await tx
      .select({
        status: reservations.status,
        eventStandId: reservations.eventStandId,
      })
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .for('update');
    if (!reservation || !CONFIRMABLE.includes(reservation.status)) {
      // INV-07: the money is kept on record; an admin refunds it (POST /reservations/:id/refunds).
      await this.audit.record(tx, {
        actorId: null,
        action: 'payment.late_conflict',
        entityType: 'reservation',
        entityId: reservationId,
        after: {
          code: 'LATE_PAYMENT_CONFLICT',
          paymentId,
          reservationStatus: reservation?.status ?? null,
        },
      });
      return 'LATE_PAYMENT_CONFLICT';
    }
    const now = new Date();
    await tx
      .update(reservations)
      .set({ status: 'CONFIRMED', updatedAt: now })
      .where(eq(reservations.id, reservationId));
    await tx
      .update(eventStands)
      .set({ status: 'ASSIGNED', updatedAt: now })
      .where(eq(eventStands.id, reservation.eventStandId));
    await this.audit.record(tx, {
      actorId: null,
      action: 'reservation.confirmed',
      entityType: 'reservation',
      entityId: reservationId,
      before: { status: reservation.status },
      after: { status: 'CONFIRMED', paymentId },
    });
    return 'CONFIRMED';
  }

  private async finish(
    inboxId: string,
    status: WebhookInboxStatus,
    outcome: string,
  ): Promise<void> {
    await this.database.db
      .update(paymentWebhookInbox)
      .set({ status, outcome, processedAt: new Date() })
      .where(eq(paymentWebhookInbox.id, inboxId));
  }

  /** ADR 0006 §3: `ts` drift is logged until sandbox shows whether retries are re-signed. */
  private logDrift(requestId: string, signature: string | undefined): void {
    const ts = Number(/(?:^|,)\s*ts=(\d+)/.exec(signature ?? '')?.[1]);
    if (Number.isFinite(ts))
      this.logger.log(
        `Mercado Pago webhook ${requestId} ts drift ${Math.round(Date.now() / 1000 - ts)}s`,
      );
  }
}

import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InvalidWebhookSignatureError, WebhookSignatureValidator } from 'mercadopago';
import { configuration, type AppConfiguration } from '../config/configuration.js';
import { DatabaseService, isUuid, type Transaction } from '../db/database.service.js';
import {
  eventStands,
  paymentAttempts,
  paymentWebhookInbox,
  reservations,
  type WebhookInboxStatus,
} from '../db/schema.js';
import { AuditService } from '../tenancy/audit.service.js';
import {
  PAYMENT_PROVIDER,
  paymentsUnavailable,
  type PaymentProvider,
  type ProviderPayment,
} from './payment-provider.js';

export interface Notification {
  readonly signature: string | undefined;
  readonly requestId: string | undefined;
  readonly dataId: string;
  readonly topic: string;
  /** Unsigned hint we put in `notification_url` (PAY-02). */
  readonly tenant: string | undefined;
}

/** States that still own the stand and can be confirmed (§4.5). */
const CONFIRMABLE: readonly string[] = ['HELD', 'PAYMENT_PENDING'];

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
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(configuration.KEY) env: AppConfiguration,
  ) {
    this.secret = env.mercadoPago.webhookSecret;
  }

  /** Returns the inbox id to process, or null for a duplicate or an ignored notification. */
  async receive(notification: Notification): Promise<string | null> {
    if (!this.secret) throw paymentsUnavailable();
    const { signature, requestId, dataId, topic, tenant } = notification;
    if (!requestId) throw new UnauthorizedException('Invalid webhook signature.');
    try {
      WebhookSignatureValidator.validate({ xSignature: signature, xRequestId: requestId, dataId, secret: this.secret });
    } catch (error) {
      if (!(error instanceof InvalidWebhookSignatureError)) throw error;
      this.logger.warn(`Rejected Mercado Pago webhook ${requestId}: ${error.reason}`);
      throw new UnauthorizedException('Invalid webhook signature.');
    }
    this.logDrift(requestId, signature);

    const tenantId = isUuid(tenant) ? tenant : null;
    const ignored = topic !== 'payment' ? 'UNSUPPORTED_TOPIC' : tenantId ? null : 'MISSING_TENANT';
    const [row] = await this.database.db
      .insert(paymentWebhookInbox)
      .values({
        requestId,
        topic,
        dataId,
        tenantId,
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
      if (!entry?.tenantId || entry.status !== 'RECEIVED') return;
      const tenantId = entry.tenantId;
      let payment: ProviderPayment;
      try {
        payment = await this.provider.getPayment(tenantId, entry.dataId);
      } catch {
        return await this.finish(inboxId, 'FAILED', 'PROVIDER_ERROR');
      }
      const outcome = await this.applyPayment(tenantId, payment);
      await this.finish(inboxId, outcome === 'UNKNOWN_ATTEMPT' ? 'IGNORED' : 'PROCESSED', outcome);
    } catch (error) {
      this.logger.error(`Mercado Pago webhook ${inboxId} failed`, error instanceof Error ? error.stack : undefined);
      await this.finish(inboxId, 'FAILED', 'INTERNAL_ERROR').catch(() => undefined);
    }
  }

  /**
   * Applies a payment read server-to-server (webhook or reconciliation) and returns the outcome
   * (CONFIRMED, ALREADY_APPROVED, AMOUNT_MISMATCH, LATE_PAYMENT_CONFLICT, UNKNOWN_ATTEMPT, PAYMENT_<status>).
   */
  applyPayment(tenantId: string, payment: ProviderPayment): Promise<string> {
    return this.database.withTenant(tenantId, (tx) => this.apply(tx, payment));
  }

  /** §6.7: match reference, amount and currency; confirm under lock; record every outcome. */
  private async apply(tx: Transaction, payment: ProviderPayment): Promise<string> {
    if (!isUuid(payment.externalReference)) return 'UNKNOWN_ATTEMPT';
    const [attempt] = await tx
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, payment.externalReference))
      .for('update');
    if (!attempt) return 'UNKNOWN_ATTEMPT';
    // ponytail: the collector check arrives with PAY-07, where the seller id comes from the OAuth link.
    if (payment.amountCents !== attempt.amountCents || payment.currency !== attempt.currency) {
      this.logger.warn(`Payment ${payment.id} does not match attempt ${attempt.id}`);
      await this.audit.record(tx, {
        actorId: null,
        action: 'payment.mismatch',
        entityType: 'payment_attempt',
        entityId: attempt.id,
        after: { paymentId: payment.id, amountCents: payment.amountCents, currency: payment.currency },
      });
      return 'AMOUNT_MISMATCH';
    }
    // Monotonic: refunds and chargebacks of an approved attempt belong to PAY-06.
    if (attempt.status === 'APPROVED') return 'ALREADY_APPROVED';

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
    // pending / in_process / rejected / cancelled: the preference stays payable until it expires.
    if (!approved) return `PAYMENT_${payment.status.toUpperCase()}`;
    return this.confirm(tx, attempt.reservationId, payment.id);
  }

  private async confirm(tx: Transaction, reservationId: string, paymentId: string): Promise<string> {
    const [reservation] = await tx
      .select({ status: reservations.status, eventStandId: reservations.eventStandId })
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .for('update');
    if (!reservation || !CONFIRMABLE.includes(reservation.status)) {
      // INV-07: the money is kept on record; the refund is handled by reconciliation (PAY-05).
      await this.audit.record(tx, {
        actorId: null,
        action: 'payment.late_conflict',
        entityType: 'reservation',
        entityId: reservationId,
        after: { code: 'LATE_PAYMENT_CONFLICT', paymentId, reservationStatus: reservation?.status ?? null },
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

  private async finish(inboxId: string, status: WebhookInboxStatus, outcome: string): Promise<void> {
    await this.database.db
      .update(paymentWebhookInbox)
      .set({ status, outcome, processedAt: new Date() })
      .where(eq(paymentWebhookInbox.id, inboxId));
  }

  /** ADR 0006 §3: `ts` drift is logged until sandbox shows whether retries are re-signed. */
  private logDrift(requestId: string, signature: string | undefined): void {
    const ts = Number(/(?:^|,)\s*ts=(\d+)/.exec(signature ?? '')?.[1]);
    if (Number.isFinite(ts))
      this.logger.log(`Mercado Pago webhook ${requestId} ts drift ${Math.round(Date.now() / 1000 - ts)}s`);
  }
}

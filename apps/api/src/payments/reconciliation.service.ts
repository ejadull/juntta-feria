import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq, gt, inArray, lt, or } from 'drizzle-orm';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { DatabaseService } from '../db/database.service.js';
import {
  paymentAttempts,
  paymentWebhookInbox,
  reservations,
  tenants,
} from '../db/schema.js';
import { AuditService } from '../tenancy/audit.service.js';
import { MercadoPagoWebhooksService } from './mercadopago-webhooks.service.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderPayment,
} from './payment-provider.js';

/** §6.6 reconciliation window: a payment may still land right after the preference expires. */
export const RECONCILIATION_GRACE_MINUTES = 5;
const INTERVAL_MS = 60_000;
/** A RECEIVED notification older than this was lost by a restart. */
const STUCK_MS = 60_000;
/** Mercado Pago itself stops retrying after ~4 days (15 min, 6/48/96 h). */
const INBOX_RETRY_WINDOW_MS = 4 * 86_400_000;
/** Payments that may still be approved: the hold is kept while one exists. */
const IN_FLIGHT = ['pending', 'in_process', 'authorized', 'in_mediation'];

type Settlement = 'confirmed' | 'expired' | 'kept' | 'unreachable';

export interface ReconciliationSummary {
  readonly webhooksRetried: number;
  readonly confirmed: number;
  readonly expired: number;
  readonly kept: number;
  /** The provider did not answer: nothing was released (§6.6). */
  readonly unreachable: number;
}

interface Overdue {
  readonly reservationId: string;
  readonly attemptId: string;
  readonly amountCents: number;
  readonly currency: string;
}

/**
 * Reconciliation job (PAY-05, §6.6–6.8, INV-07). Retries failed webhooks and settles reservations
 * whose checkout outlived the hold: confirm if the provider has an approved payment, keep while one
 * is in flight or the provider does not answer, expire (freeing the stand) only when none can land.
 * Safe to run twice at once: every change re-checks the state under a row lock.
 */
@Injectable()
export class ReconciliationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ReconciliationService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly webhooks: MercadoPagoWebhooksService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(configuration.KEY) private readonly env: AppConfiguration,
  ) {}

  /** ponytail: in-process interval; move to a BullMQ repeatable job when the API scales out. */
  onApplicationBootstrap(): void {
    if (this.env.nodeEnv === 'test') return; // tests call run() with a controlled clock
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async run(now: Date = new Date()): Promise<ReconciliationSummary> {
    const webhooksRetried = await this.retryWebhooks(now);
    const totals: Record<Settlement, number> = {
      confirmed: 0,
      expired: 0,
      kept: 0,
      unreachable: 0,
    };
    const all = await this.database.db.select({ id: tenants.id }).from(tenants);
    for (const { id } of all)
      for (const result of await this.settleTenant(id, now))
        totals[result] += 1;
    return { webhooksRetried, ...totals };
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const summary = await this.run();
      // Alert (§1.4): a provider that does not answer leaves stands held; a human must look.
      if (summary.unreachable > 0)
        this.logger.warn(
          `Reconciliation could not reach the provider: ${JSON.stringify(summary)}`,
        );
      else if (summary.confirmed + summary.expired > 0)
        this.logger.log(`Reconciliation: ${JSON.stringify(summary)}`);
    } catch (error) {
      this.logger.error(
        'Reconciliation failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }

  private async retryWebhooks(now: Date): Promise<number> {
    const due = await this.database.db
      .select({ id: paymentWebhookInbox.id })
      .from(paymentWebhookInbox)
      .where(
        and(
          gt(
            paymentWebhookInbox.receivedAt,
            new Date(now.getTime() - INBOX_RETRY_WINDOW_MS),
          ),
          or(
            eq(paymentWebhookInbox.status, 'FAILED'),
            and(
              eq(paymentWebhookInbox.status, 'RECEIVED'),
              lt(
                paymentWebhookInbox.receivedAt,
                new Date(now.getTime() - STUCK_MS),
              ),
            ),
          ),
        ),
      );
    for (const { id } of due) {
      await this.database.db
        .update(paymentWebhookInbox)
        .set({ status: 'RECEIVED', outcome: null })
        .where(
          and(
            eq(paymentWebhookInbox.id, id),
            inArray(paymentWebhookInbox.status, ['FAILED', 'RECEIVED']),
          ),
        );
      await this.webhooks.process(id);
    }
    return due.length;
  }

  private async settleTenant(
    tenantId: string,
    now: Date,
  ): Promise<Settlement[]> {
    const deadline = new Date(
      now.getTime() - RECONCILIATION_GRACE_MINUTES * 60_000,
    );
    const overdue: Overdue[] = await this.database.withTenant(tenantId, (tx) =>
      tx
        .select({
          reservationId: reservations.id,
          attemptId: paymentAttempts.id,
          amountCents: paymentAttempts.amountCents,
          currency: paymentAttempts.currency,
        })
        .from(reservations)
        .innerJoin(
          paymentAttempts,
          and(
            eq(paymentAttempts.reservationId, reservations.id),
            eq(paymentAttempts.status, 'PENDING'),
          ),
        )
        .where(
          and(
            eq(reservations.status, 'PAYMENT_PENDING'),
            lt(reservations.holdExpiresAt, deadline),
          ),
        ),
    );
    const results: Settlement[] = [];
    for (const item of overdue)
      results.push(await this.settle(tenantId, item, deadline));
    return results;
  }

  private async settle(
    tenantId: string,
    item: Overdue,
    deadline: Date,
  ): Promise<Settlement> {
    let payments: ProviderPayment[];
    try {
      payments = await this.provider.findPayments(tenantId, item.attemptId);
    } catch {
      return 'unreachable';
    }
    const approved = payments.filter((p) => p.status === 'approved');
    const matching = approved.find(
      (p) => p.amountCents === item.amountCents && p.currency === item.currency,
    );
    if (matching) {
      const outcome = await this.webhooks.applyPayment(tenantId, matching);
      return outcome === 'CONFIRMED' ? 'confirmed' : 'kept';
    }
    if (approved.length > 0) {
      // Approved but not for the snapshot amount: money arrived, so a human decides (never release).
      this.logger.warn(
        `Attempt ${item.attemptId} has an approved payment that does not match its amount`,
      );
      return 'kept';
    }
    if (payments.some((p) => IN_FLIGHT.includes(p.status))) return 'kept';
    return (await this.expire(tenantId, item, deadline)) ? 'expired' : 'kept';
  }

  /** No payment can land any more: release the stand. Re-checked under lock (a webhook may have won). */
  private expire(
    tenantId: string,
    item: Overdue,
    deadline: Date,
  ): Promise<boolean> {
    return this.database.withTenant(tenantId, async (tx) => {
      const [reservation] = await tx
        .select({
          status: reservations.status,
          holdExpiresAt: reservations.holdExpiresAt,
        })
        .from(reservations)
        .where(eq(reservations.id, item.reservationId))
        .for('update');
      const holdExpiresAt = reservation?.holdExpiresAt;
      if (
        reservation?.status !== 'PAYMENT_PENDING' ||
        !holdExpiresAt ||
        holdExpiresAt >= deadline
      )
        return false;
      const now = new Date();
      await tx
        .update(reservations)
        .set({ status: 'EXPIRED', updatedAt: now })
        .where(eq(reservations.id, item.reservationId));
      await tx
        .update(paymentAttempts)
        .set({ status: 'EXPIRED', updatedAt: now })
        .where(
          and(
            eq(paymentAttempts.reservationId, item.reservationId),
            eq(paymentAttempts.status, 'PENDING'),
          ),
        );
      await this.audit.record(tx, {
        actorId: null,
        action: 'reservation.expired',
        entityType: 'reservation',
        entityId: item.reservationId,
        before: { status: 'PAYMENT_PENDING', holdExpiresAt },
        after: {
          status: 'EXPIRED',
          reason: 'NO_PAYMENT',
          paymentAttemptId: item.attemptId,
        },
      });
      return true;
    });
  }
}

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { DatabaseService, isUuid } from '../db/database.service.js';
import {
  memberships,
  platformSubscriptions,
  users,
  type SubscriptionStatus,
} from '../db/schema.js';
import { fail } from '../reservations/reservations.service.js';
import {
  PAYMENT_PROVIDER,
  paymentsUnavailable,
  type PaymentProvider,
  type ProviderSubscription,
} from './payment-provider.js';

/** `NONE` is only the answer of GET when the user never subscribed; it is not stored. */
export interface SubscriptionView {
  readonly status: SubscriptionStatus | 'NONE';
  readonly currentPeriodEnd?: Date | null;
  /** Where the payer authorizes the charge; only while PENDING. */
  readonly initPoint?: string;
}

type Row = typeof platformSubscriptions.$inferSelect;

const CURRENCY = 'ARS';
const REASON = 'Suscripción Juntta Feria';
export const SUBSCRIPTION_TOPICS: readonly string[] = [
  'subscription_preapproval',
  'subscription_authorized_payment',
];

const view = (row: Row): SubscriptionView => ({
  status: row.status,
  currentPeriodEnd: row.currentPeriodEnd,
  ...(row.status === 'PENDING' && row.initPoint
    ? { initPoint: row.initPoint }
    : {}),
});

/** What the first transaction of `start` decided. */
type Plan =
  | { readonly kind: 'existing'; readonly row: Row }
  | {
      readonly kind: 'create';
      readonly email: string;
      readonly key: string;
      /** A preapproval of ours that must stop charging before the new one exists. */
      readonly stale: string | null;
    };

/**
 * Subscription of the exhibitor TO THE PLATFORM (EXH-05): one `preapproval` per user, charged in
 * Juntta's own Mercado Pago account, global like the user (no tenant). The provider is never
 * called inside a transaction: reserve the row, create the preapproval, persist it once.
 *
 * No `audit_logs` entry: that table is RLS-forced per tenant and a platform subscription has
 * none. The trail is the row itself (`provider_status`, `updated_at`), the webhook inbox
 * (every notification and its outcome) and the structured log below.
 */
@Injectable()
export class PlatformSubscriptionsService {
  private readonly logger = new Logger(PlatformSubscriptionsService.name);
  private readonly webOrigin: string;
  private readonly priceCents: number | undefined;

  constructor(
    private readonly database: DatabaseService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(configuration.KEY) env: AppConfiguration,
  ) {
    this.webOrigin = env.corsOrigins.find((origin) => origin !== '*') ?? '';
    this.priceCents = env.mercadoPago.subscriptionPriceCents;
  }

  async get(userId: string): Promise<SubscriptionView> {
    const row = await this.find(userId);
    return row ? view(row) : { status: 'NONE' };
  }

  /** `created` is true when this request created the preapproval (201), false on a replay (200). */
  async start(
    userId: string,
    requestedEmail: string | undefined,
    idempotencyKey: string,
  ): Promise<{ subscription: SubscriptionView; created: boolean }> {
    const priceCents = this.priceCents;
    if (!priceCents) throw paymentsUnavailable();
    const plan = await this.plan(userId, requestedEmail, idempotencyKey);
    if (plan.kind === 'existing')
      return { subscription: view(plan.row), created: false };

    if (plan.stale) await this.cancelStale(plan.stale);
    const created = await this.provider.createSubscription({
      externalReference: userId,
      reason: REASON,
      payerEmail: plan.email,
      amountCents: priceCents,
      currency: CURRENCY,
      backUrl: `${this.webOrigin}/feriante/suscripcion`,
      idempotencyKey: plan.key,
    });
    const [saved] = await this.database.db
      .update(platformSubscriptions)
      .set({
        providerSubscriptionId: created.id,
        initPoint: created.initPoint,
        providerStatus: created.status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(platformSubscriptions.userId, userId),
          eq(platformSubscriptions.idempotencyKey, plan.key),
          isNull(platformSubscriptions.providerSubscriptionId),
        ),
      )
      .returning();
    if (saved) {
      this.logger.log(`Subscription of user ${userId}: PENDING`);
      return { subscription: view(saved), created: true };
    }
    // A concurrent request persisted the same preapproval first (same provider key).
    const current = await this.find(userId);
    if (!current) throw new NotFoundException('Subscription not found.');
    return { subscription: view(current), created: false };
  }

  /**
   * Cancels at the provider (irreversible) and then marks it CANCELLED. The period already paid
   * is kept: the reservation gate honors `current_period_end` for CANCELLED. Idempotent.
   */
  async cancel(userId: string): Promise<SubscriptionView> {
    const row = await this.find(userId);
    if (!row)
      throw fail(
        NotFoundException,
        'SUBSCRIPTION_NOT_FOUND',
        'You have no subscription.',
      );
    if (row.status === 'CANCELLED') return view(row);
    if (row.providerSubscriptionId)
      await this.provider.cancelSubscription(row.providerSubscriptionId);
    const [saved] = await this.database.db
      .update(platformSubscriptions)
      .set({
        status: 'CANCELLED',
        providerStatus: 'cancelled',
        initPoint: null,
        updatedAt: new Date(),
      })
      .where(eq(platformSubscriptions.userId, userId))
      .returning();
    this.logger.log(`Subscription of user ${userId}: CANCELLED`);
    return view(saved);
  }

  /**
   * Webhook entry (§6.7 spirit): only the id of the notification is trusted. The preapproval is
   * re-read server-to-server and applied. Provider failures propagate for the retry job.
   */
  async sync(topic: string, dataId: string): Promise<string> {
    if (topic === 'subscription_authorized_payment') {
      const payment = await this.provider.getAuthorizedPayment(dataId);
      if (!payment.preapprovalId) return 'UNKNOWN_SUBSCRIPTION';
      return this.apply(
        await this.provider.getSubscription(payment.preapprovalId),
      );
    }
    return this.apply(await this.provider.getSubscription(dataId));
  }

  /** Locks the row; CANCELLED is final (cancelling at Mercado Pago is irreversible). */
  private async apply(sub: ProviderSubscription): Promise<string> {
    if (!isUuid(sub.externalReference)) return 'UNKNOWN_SUBSCRIPTION';
    const userId = sub.externalReference;
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(platformSubscriptions)
        .where(eq(platformSubscriptions.userId, userId))
        .for('update');
      // A preapproval we replaced (new email, re-subscribe) is not the current one.
      if (!row || row.providerSubscriptionId !== sub.id)
        return 'UNKNOWN_SUBSCRIPTION';
      if (row.status === 'CANCELLED') return 'ALREADY_CANCELLED';

      const change = async (
        status: SubscriptionStatus,
        outcome: string,
        end: Date | null = row.currentPeriodEnd,
      ): Promise<string> => {
        await tx
          .update(platformSubscriptions)
          .set({
            status,
            currentPeriodEnd: end,
            providerStatus: sub.status,
            initPoint: status === 'PENDING' ? row.initPoint : null,
            updatedAt: new Date(),
          })
          .where(eq(platformSubscriptions.userId, userId));
        if (status !== row.status)
          this.logger.log(`Subscription of user ${userId}: ${status}`);
        return outcome;
      };

      switch (sub.status) {
        case 'authorized': {
          // ponytail: access lasts until the next charge date, with no grace days; Mercado Pago
          // pauses the preapproval after failed retries, which is when PAST_DUE starts.
          const end = sub.nextPaymentDate ?? row.currentPeriodEnd;
          if (!end) return 'MISSING_PERIOD';
          const renewing = row.status === 'ACTIVE';
          if (renewing && row.currentPeriodEnd?.getTime() === end.getTime())
            return 'UNCHANGED';
          return change('ACTIVE', renewing ? 'RENEWED' : 'ACTIVATED', end);
        }
        case 'paused':
          return change('PAST_DUE', 'PAST_DUE');
        case 'cancelled':
          return change('CANCELLED', 'CANCELLED');
        case 'pending':
          return change(row.status, 'PENDING');
        default:
          return 'UNKNOWN_STATUS';
      }
    });
  }

  private plan(
    userId: string,
    requestedEmail: string | undefined,
    key: string,
  ): Promise<Plan> {
    return this.database.db.transaction(async (tx) => {
      // The subscription pays for reserving, so it is for exhibitors; it also keeps arbitrary
      // accounts from creating preapprovals in the platform's Mercado Pago account.
      const [membership] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, userId),
            eq(memberships.role, 'EXHIBITOR'),
            eq(memberships.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (!membership)
        throw fail(
          ForbiddenException,
          'EXHIBITOR_REQUIRED',
          'Only exhibitors can subscribe.',
        );
      const [user] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId));
      if (!user) throw new NotFoundException('User not found.');
      const accountEmail = user.email.toLowerCase();

      await tx
        .insert(platformSubscriptions)
        .values({
          userId,
          status: 'PENDING',
          payerEmail: requestedEmail ?? accountEmail,
          idempotencyKey: key,
        })
        .onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(platformSubscriptions)
        .where(eq(platformSubscriptions.userId, userId))
        .for('update');

      if (row.status === 'ACTIVE')
        throw fail(
          ConflictException,
          'SUBSCRIPTION_ALREADY_ACTIVE',
          'You already have an active subscription.',
        );
      const email = requestedEmail ?? row.payerEmail ?? accountEmail;
      const emailChanged = row.payerEmail !== null && email !== row.payerEmail;

      if (row.status === 'PENDING' && !emailChanged) {
        if (row.providerSubscriptionId && row.initPoint)
          return { kind: 'existing', row } as const;
        // Reserved but never created (provider failure): finish it with the same provider key.
        return {
          kind: 'create',
          email,
          key: row.idempotencyKey ?? key,
          stale: null,
        } as const;
      }
      // PAST_DUE (paused at the provider), CANCELLED, or a PENDING one with the wrong email:
      // start over. A paused or pending preapproval would keep charging if left behind.
      const stale =
        row.status === 'CANCELLED' ? null : row.providerSubscriptionId;
      await tx
        .update(platformSubscriptions)
        .set({
          status: 'PENDING',
          payerEmail: email,
          idempotencyKey: key,
          providerSubscriptionId: null,
          initPoint: null,
          providerStatus: null,
          updatedAt: new Date(),
        })
        .where(eq(platformSubscriptions.userId, userId));
      return { kind: 'create', email, key, stale } as const;
    });
  }

  /** Best effort: the old preapproval must not outlive its replacement, but never blocks it. */
  private async cancelStale(providerId: string): Promise<void> {
    try {
      await this.provider.cancelSubscription(providerId);
    } catch {
      this.logger.warn(
        'Could not cancel a replaced preapproval; it may need a manual cancel in Mercado Pago.',
      );
    }
  }

  private async find(userId: string): Promise<Row | undefined> {
    const [row] = await this.database.db
      .select()
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.userId, userId));
    return row;
  }
}

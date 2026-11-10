import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { DatabaseService, type Transaction } from '../db/database.service.js';
import {
  events,
  eventStands,
  paymentAttempts,
  reservations,
  users,
  type PaymentAttemptStatus,
} from '../db/schema.js';
import {
  PAYMENT_PROVIDER,
  type Checkout,
  type CheckoutRequest,
  type PaymentProvider,
} from '../payments/payment-provider.js';
import { AuditService } from '../tenancy/audit.service.js';
import { fail } from './reservations.service.js';

/** Wallet settings kept for the web; Orders API checkout is a redirect, so the web gets `null` (ADR 0007). */
export interface WalletSettings {
  /** The platform's public key, also in marketplace mode. */
  readonly publicKey: string;
  /** True when the organizer's linked seller account collects (PAY-07). */
  readonly marketplace: boolean;
}

/** §5.2 response: our attempt id and public checkout data, never provider credentials. */
export interface CheckoutView {
  readonly paymentAttemptId: string;
  /** The order's `checkout_url`: the web redirects the buyer there. */
  readonly checkoutUrl: string;
  /**
   * Backward compatible name: since ADR 0007 this is the provider's ORDER id (it used to be the
   * Preferences id the Wallet Brick rendered).
   */
  readonly preferenceId: string;
  /** Always null: an Orders checkout has no Wallet Brick, so the web falls back to `checkoutUrl`. */
  readonly wallet: WalletSettings | null;
  readonly status: PaymentAttemptStatus;
}

type Attempt = typeof paymentAttempts.$inferSelect;

const notPayable = () =>
  fail(
    ConflictException,
    'RESERVATION_NOT_PAYABLE',
    'Only a live hold can be paid.',
  );

const view = (attempt: Attempt): CheckoutView => ({
  paymentAttemptId: attempt.id,
  checkoutUrl: attempt.checkoutUrl ?? '',
  preferenceId: attempt.providerCheckoutId ?? '',
  wallet: null,
  status: attempt.status,
});

/**
 * Checkout of a reservation (PAY-02, §6.5). Three steps so the provider call never runs inside
 * a transaction: open (or reuse) the attempt, create the order, persist it once.
 * A provider failure leaves the hold and the attempt as they were; a retry completes them.
 */
@Injectable()
export class CheckoutService {
  private readonly webOrigin: string;
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(configuration.KEY) env: AppConfiguration,
  ) {
    this.webOrigin = env.corsOrigins.find((origin) => origin !== '*') ?? '';
  }

  /** `created` is true when this request opened the checkout (201), false on a replay (200). */
  async checkout(
    tenantId: string,
    userId: string,
    reservationId: string,
    idempotencyKey: string,
  ): Promise<{ checkout: CheckoutView; created: boolean }> {
    const { attempt, created } = await this.openCheckout(
      tenantId,
      userId,
      reservationId,
      idempotencyKey,
    );
    return { checkout: view(attempt), created };
  }

  private async openCheckout(
    tenantId: string,
    userId: string,
    reservationId: string,
    idempotencyKey: string,
  ): Promise<{ attempt: Attempt; created: boolean }> {
    const { attempt, title, payer } = await this.database.withTenant(
      tenantId,
      (tx) => this.openAttempt(tx, userId, reservationId, idempotencyKey),
    );
    if (attempt.checkoutUrl) return { attempt, created: false };

    const result = await this.provider.createCheckout({
      tenantId,
      externalReference: attempt.id,
      title,
      amountCents: attempt.amountCents,
      currency: attempt.currency,
      expiresAt: attempt.expiresAt,
      backUrls: this.backUrls(reservationId),
      payer,
    });
    return this.database.withTenant(tenantId, (tx) =>
      this.saveCheckout(tx, userId, attempt, result),
    );
  }

  /** Locks the reservation, so concurrent checkouts of it share one attempt. */
  private async openAttempt(
    tx: Transaction,
    userId: string,
    reservationId: string,
    idempotencyKey: string,
  ): Promise<{
    attempt: Attempt;
    title: string;
    payer: CheckoutRequest['payer'];
  }> {
    const [reservation] = await tx
      .select({
        status: reservations.status,
        holdExpiresAt: reservations.holdExpiresAt,
        priceCents: reservations.priceCents,
        currency: reservations.currency,
        standCode: eventStands.code,
        eventName: events.name,
      })
      .from(reservations)
      .innerJoin(eventStands, eq(eventStands.id, reservations.eventStandId))
      .innerJoin(events, eq(events.id, eventStands.eventId))
      .where(
        and(
          eq(reservations.id, reservationId),
          eq(reservations.userId, userId),
        ),
      )
      .for('update', { of: reservations });
    if (!reservation) throw new NotFoundException('Reservation not found.');
    const payer = await this.payerOf(tx, userId);
    const title = `Stand ${reservation.standCode} — ${reservation.eventName}`;
    const holdExpiresAt = reservation.holdExpiresAt;
    const liveHold =
      reservation.status === 'HELD' &&
      !!holdExpiresAt &&
      holdExpiresAt > new Date();
    if (!liveHold && reservation.status !== 'PAYMENT_PENDING')
      throw notPayable();

    // Same key → its attempt; otherwise the open one: never a second order per reservation.
    const attempts = await tx
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.reservationId, reservationId));
    const reused =
      attempts.find((a) => a.idempotencyKey === idempotencyKey) ??
      attempts.find((a) => a.status === 'PENDING');
    if (reused) return { attempt: reused, title, payer };
    if (!liveHold || !holdExpiresAt) throw notPayable();

    const [attempt] = await tx
      .insert(paymentAttempts)
      .values({
        reservationId,
        amountCents: reservation.priceCents,
        currency: reservation.currency,
        // The order must not outlive the hold (PAY-02, ADR 0006 §5).
        expiresAt: holdExpiresAt,
        idempotencyKey,
      })
      .returning();
    await this.audit.record(tx, {
      actorId: userId,
      action: 'payment_attempt.created',
      entityType: 'payment_attempt',
      entityId: attempt.id,
      after: {
        reservationId,
        amountCents: attempt.amountCents,
        currency: attempt.currency,
      },
    });
    return { attempt, title, payer };
  }

  /** First order wins; a concurrent loser answers with the persisted one. */
  private async saveCheckout(
    tx: Transaction,
    userId: string,
    attempt: Attempt,
    result: Checkout,
  ): Promise<{ attempt: Attempt; created: boolean }> {
    const [saved] = await tx
      .update(paymentAttempts)
      .set({
        providerCheckoutId: result.checkoutId,
        checkoutUrl: result.checkoutUrl,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paymentAttempts.id, attempt.id),
          isNull(paymentAttempts.providerCheckoutId),
        ),
      )
      .returning();
    if (!saved) {
      const [current] = await tx
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, attempt.id));
      return { attempt: current, created: false };
    }
    // HELD → PAYMENT_PENDING (§4.5): from now on the hold is not released blindly (§6.6, PAY-05).
    const moved = await tx
      .update(reservations)
      .set({ status: 'PAYMENT_PENDING', updatedAt: new Date() })
      .where(
        and(
          eq(reservations.id, attempt.reservationId),
          eq(reservations.status, 'HELD'),
        ),
      )
      .returning({ id: reservations.id });
    if (moved.length > 0)
      await this.audit.record(tx, {
        actorId: userId,
        action: 'reservation.payment_pending',
        entityType: 'reservation',
        entityId: attempt.reservationId,
        before: { status: 'HELD' },
        after: { status: 'PAYMENT_PENDING', paymentAttemptId: attempt.id },
      });
    return { attempt: saved, created: true };
  }

  /**
   * The payer of the order is the logged-in exhibitor, read here and never from the request.
   * The account has a single `full_name`: first token is the first name, the rest the last name.
   */
  private async payerOf(
    tx: Transaction,
    userId: string,
  ): Promise<CheckoutRequest['payer']> {
    const [user] = await tx
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) throw new NotFoundException('Reservation not found.');
    const [firstName, ...rest] = (user.fullName ?? '').trim().split(/\s+/);
    const lastName = rest.join(' ');
    return {
      email: user.email,
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
    };
  }

  /** Return pages of PAY-04 (P19); the browser return never confirms anything (§5.2). */
  private backUrls(reservationId: string) {
    const base = `${this.webOrigin}/feriante/reservas/${reservationId}/pago`;
    return {
      success: `${base}/aprobado`,
      pending: `${base}/pendiente`,
      failure: `${base}/rechazado`,
    };
  }
}

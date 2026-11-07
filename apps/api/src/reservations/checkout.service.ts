import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { configuration, type AppConfiguration } from '../config/configuration.js';
import { DatabaseService, type Transaction } from '../db/database.service.js';
import {
  events,
  eventStands,
  paymentAttempts,
  reservations,
  type PaymentAttemptStatus,
} from '../db/schema.js';
import {
  PAYMENT_PROVIDER,
  type Checkout,
  type PaymentProvider,
} from '../payments/payment-provider.js';
import { AuditService } from '../tenancy/audit.service.js';
import { fail } from './reservations.service.js';

/** §5.2 response: only our attempt id and the provider URL, never provider credentials. */
export interface CheckoutView {
  readonly paymentAttemptId: string;
  readonly checkoutUrl: string;
  readonly status: PaymentAttemptStatus;
}

type Attempt = typeof paymentAttempts.$inferSelect;

const notPayable = () =>
  fail(ConflictException, 'RESERVATION_NOT_PAYABLE', 'Only a live hold can be paid.');

const view = (attempt: Attempt): CheckoutView => ({
  paymentAttemptId: attempt.id,
  checkoutUrl: attempt.checkoutUrl ?? '',
  status: attempt.status,
});

/**
 * Checkout of a reservation (PAY-02, §6.5). Three steps so the provider call never runs inside
 * a transaction: open (or reuse) the attempt, create the preference, persist it once.
 * A provider failure leaves the hold and the attempt as they were; a retry completes them.
 */
@Injectable()
export class CheckoutService {
  private readonly webOrigin: string;
  private readonly notificationUrl: string | undefined;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(configuration.KEY) env: AppConfiguration,
  ) {
    this.webOrigin = env.corsOrigins.find((origin) => origin !== '*') ?? '';
    this.notificationUrl = env.mercadoPago.notificationUrl;
  }

  /** `created` is true when this request opened the checkout (201), false on a replay (200). */
  async checkout(
    tenantId: string,
    userId: string,
    reservationId: string,
    idempotencyKey: string,
  ): Promise<{ checkout: CheckoutView; created: boolean }> {
    const { attempt, title } = await this.database.withTenant(tenantId, (tx) =>
      this.openAttempt(tx, userId, reservationId, idempotencyKey),
    );
    if (attempt.checkoutUrl) return { checkout: view(attempt), created: false };

    const result = await this.provider.createCheckout({
      tenantId,
      externalReference: attempt.id,
      title,
      amountCents: attempt.amountCents,
      currency: attempt.currency,
      expiresAt: attempt.expiresAt,
      backUrls: this.backUrls(reservationId),
      ...(this.notificationUrl ? { notificationUrl: this.notificationFor(tenantId) } : {}),
    });
    return this.database.withTenant(tenantId, (tx) => this.saveCheckout(tx, userId, attempt, result));
  }

  /** Locks the reservation, so concurrent checkouts of it share one attempt. */
  private async openAttempt(
    tx: Transaction,
    userId: string,
    reservationId: string,
    idempotencyKey: string,
  ): Promise<{ attempt: Attempt; title: string }> {
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
      .where(and(eq(reservations.id, reservationId), eq(reservations.userId, userId)))
      .for('update', { of: reservations });
    if (!reservation) throw new NotFoundException('Reservation not found.');
    const title = `Stand ${reservation.standCode} — ${reservation.eventName}`;
    const holdExpiresAt = reservation.holdExpiresAt;
    const liveHold = reservation.status === 'HELD' && !!holdExpiresAt && holdExpiresAt > new Date();
    if (!liveHold && reservation.status !== 'PAYMENT_PENDING') throw notPayable();

    // Same key → its attempt; otherwise the open one: never a second preference per reservation.
    const attempts = await tx
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.reservationId, reservationId));
    const reused =
      attempts.find((a) => a.idempotencyKey === idempotencyKey) ?? attempts.find((a) => a.status === 'PENDING');
    if (reused) return { attempt: reused, title };
    if (!liveHold || !holdExpiresAt) throw notPayable();

    const [attempt] = await tx
      .insert(paymentAttempts)
      .values({
        reservationId,
        amountCents: reservation.priceCents,
        currency: reservation.currency,
        // The preference must not outlive the hold (PAY-02, ADR 0006 §5).
        expiresAt: holdExpiresAt,
        idempotencyKey,
      })
      .returning();
    await this.audit.record(tx, {
      actorId: userId,
      action: 'payment_attempt.created',
      entityType: 'payment_attempt',
      entityId: attempt.id,
      after: { reservationId, amountCents: attempt.amountCents, currency: attempt.currency },
    });
    return { attempt, title };
  }

  /** First preference wins; a concurrent loser answers with the persisted one. */
  private async saveCheckout(
    tx: Transaction,
    userId: string,
    attempt: Attempt,
    result: Checkout,
  ): Promise<{ checkout: CheckoutView; created: boolean }> {
    const [saved] = await tx
      .update(paymentAttempts)
      .set({ preferenceId: result.preferenceId, checkoutUrl: result.checkoutUrl, updatedAt: new Date() })
      .where(and(eq(paymentAttempts.id, attempt.id), isNull(paymentAttempts.preferenceId)))
      .returning();
    if (!saved) {
      const [current] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.id, attempt.id));
      return { checkout: view(current), created: false };
    }
    // HELD → PAYMENT_PENDING (§4.5): from now on the hold is not released blindly (§6.6, PAY-05).
    const moved = await tx
      .update(reservations)
      .set({ status: 'PAYMENT_PENDING', updatedAt: new Date() })
      .where(and(eq(reservations.id, attempt.reservationId), eq(reservations.status, 'HELD')))
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
    return { checkout: view(saved), created: true };
  }

  /**
   * The webhook needs the tenant to read the payment with its seller credentials (PAY-03).
   * The query is unsigned: the webhook trusts it only after the payment matches an attempt of it.
   */
  private notificationFor(tenantId: string): string {
    const url = new URL(this.notificationUrl ?? '');
    url.searchParams.set('tenant', tenantId);
    return url.toString();
  }

  /** Return pages of PAY-04 (P19); the browser return never confirms anything (§5.2). */
  private backUrls(reservationId: string) {
    const base = `${this.webOrigin}/feriante/reservas/${reservationId}/pago`;
    return { success: `${base}/aprobado`, pending: `${base}/pendiente`, failure: `${base}/rechazado` };
  }
}

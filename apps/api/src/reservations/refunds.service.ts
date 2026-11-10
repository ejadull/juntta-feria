import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import {
  DatabaseService,
  isUniqueViolation,
  type Transaction,
} from '../db/database.service.js';
import {
  eventStands,
  paymentAttempts,
  paymentRefunds,
  reservations,
  type PaymentRefundKind,
  type PaymentRefundStatus,
  type ReservationStatus,
} from '../db/schema.js';
import {
  PAYMENT_PROVIDER,
  providerFailed,
  type PaymentProvider,
  type ProviderPayment,
} from '../payments/payment-provider.js';
import { AuditService } from '../tenancy/audit.service.js';
import { fail } from './reservations.service.js';

/** Mercado Pago only refunds within 180 days of the approval. */
export const REFUND_WINDOW_DAYS = 180;
/** Payments not approved yet: they are cancelled, not refunded. */
const CANCELLABLE = ['pending', 'in_process', 'authorized'];

export interface RefundView {
  readonly id: string;
  readonly paymentId: string;
  readonly kind: PaymentRefundKind;
  readonly amountCents: number | null;
  readonly status: PaymentRefundStatus;
}

export interface RefundResult {
  readonly reservationStatus: ReservationStatus;
  readonly refunds: RefundView[];
}

type Row = typeof paymentRefunds.$inferSelect;
interface Target {
  readonly attemptId: string;
  readonly payment: ProviderPayment;
}
interface Locked {
  readonly status: ReservationStatus;
  readonly eventStandId: string;
}

const view = (row: Row): RefundView => ({
  id: row.id,
  paymentId: row.paymentId,
  kind: row.kind,
  amountCents: row.amountCents,
  status: row.status,
});

/**
 * Refunds and cancellations of a reservation's payments (PAY-06, §6.8, INV-07). Every payment
 * the provider has for the reservation's attempts is reverted, one row per `payment_id`:
 * approved → refund (total, or partial with exactly one payment), pending → cancel. Same shape
 * as the checkout: plan in a transaction, call the provider outside it, settle under lock.
 * A full reversal moves CONFIRMED → REFUND_PENDING → REFUNDED (stand free) and cancels a
 * PAYMENT_PENDING one; anything else (late conflicts, partial refunds) keeps the reservation.
 */
@Injectable()
export class RefundsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async refund(
    tenantId: string,
    actorId: string,
    reservationId: string,
    key: string,
    amountCents?: number,
  ): Promise<{ result: RefundResult; created: boolean }> {
    let rows = await this.byKey(tenantId, reservationId, key);
    const created = rows.length === 0;
    if (created) {
      const targets = await this.targets(tenantId, reservationId);
      try {
        rows = await this.plan(
          tenantId,
          actorId,
          reservationId,
          key,
          targets,
          amountCents,
        );
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        rows = await this.byKey(tenantId, reservationId, key); // the same key, concurrently
      }
    }
    // A replay resumes what a provider failure left PENDING, with the same provider keys.
    for (const row of rows)
      if (row.status === 'PENDING') await this.send(tenantId, row);
    return {
      result: await this.settle(tenantId, actorId, reservationId, key),
      created,
    };
  }

  private byKey(
    tenantId: string,
    reservationId: string,
    key: string,
  ): Promise<Row[]> {
    return this.database.withTenant(tenantId, (tx) =>
      this.rowsOf(tx, reservationId, key),
    );
  }

  private rowsOf(
    tx: Transaction,
    reservationId: string,
    key: string,
  ): Promise<Row[]> {
    return tx
      .select()
      .from(paymentRefunds)
      .where(
        and(
          eq(paymentRefunds.reservationId, reservationId),
          eq(paymentRefunds.idempotencyKey, key),
        ),
      )
      .orderBy(paymentRefunds.paymentId);
  }

  /** Every payment of the reservation that can still be reverted, read from the provider. */
  private async targets(
    tenantId: string,
    reservationId: string,
  ): Promise<Target[]> {
    const attempts = await this.database.withTenant(tenantId, async (tx) => {
      const [reservation] = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(eq(reservations.id, reservationId));
      if (!reservation) throw new NotFoundException('Reservation not found.');
      return tx
        .select({
          id: paymentAttempts.id,
          checkoutId: paymentAttempts.providerCheckoutId,
        })
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.reservationId, reservationId),
            isNotNull(paymentAttempts.providerCheckoutId),
          ),
        );
    });
    const targets: Target[] = [];
    for (const { id, checkoutId } of attempts)
      for (const payment of checkoutId
        ? await this.provider.getPayments(tenantId, checkoutId)
        : [])
        if (
          payment.status === 'approved' ||
          CANCELLABLE.includes(payment.status)
        )
          targets.push({ attemptId: id, payment });
    return targets;
  }

  private plan(
    tenantId: string,
    actorId: string,
    reservationId: string,
    key: string,
    found: Target[],
    amountCents: number | undefined,
  ): Promise<Row[]> {
    return this.database.withTenant(tenantId, async (tx) => {
      const reservation = await this.lock(tx, reservationId);
      const earlier = await tx
        .select({
          paymentId: paymentRefunds.paymentId,
          status: paymentRefunds.status,
          amount: paymentRefunds.amountCents,
        })
        .from(paymentRefunds)
        .where(
          and(
            eq(paymentRefunds.reservationId, reservationId),
            ne(paymentRefunds.idempotencyKey, key),
          ),
        );
      if (earlier.some((r) => r.status === 'PENDING'))
        throw fail(
          ConflictException,
          'REFUND_IN_PROGRESS',
          'Another refund of this reservation is in progress.',
        );
      // The provider may lag behind a reversal we already completed.
      const reverted = new Set(
        earlier.filter((r) => r.amount === null).map((r) => r.paymentId),
      );
      const targets = found.filter((t) => !reverted.has(t.payment.id));
      if (targets.length === 0)
        throw fail(
          ConflictException,
          'NOTHING_TO_REFUND',
          'The reservation has no payment left to refund.',
        );
      check(targets, amountCents);

      const rows = await tx
        .insert(paymentRefunds)
        .values(
          targets.map(({ attemptId, payment }) => ({
            reservationId,
            attemptId,
            paymentId: payment.id,
            kind:
              payment.status === 'approved'
                ? ('REFUND' as const)
                : ('CANCEL' as const),
            amountCents: amountCents ?? null,
            idempotencyKey: key,
            actorId,
          })),
        )
        .returning();
      if (amountCents === undefined && reservation.status === 'CONFIRMED')
        await this.move(
          tx,
          actorId,
          reservationId,
          'CONFIRMED',
          'REFUND_PENDING',
          'reservation.refund_pending',
        );
      await this.audit.record(tx, {
        actorId,
        action: 'payment.refund_requested',
        entityType: 'reservation',
        entityId: reservationId,
        after: { refunds: rows.map(view) },
      });
      return rows;
    });
  }

  /** The provider order of the attempt a row reverts (Orders refund and cancel address the order). */
  private async checkoutOf(
    tenantId: string,
    attemptId: string,
  ): Promise<string> {
    const [attempt] = await this.database.withTenant(tenantId, (tx) =>
      tx
        .select({ checkoutId: paymentAttempts.providerCheckoutId })
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, attemptId)),
    );
    if (!attempt?.checkoutId) throw providerFailed();
    return attempt.checkoutId;
  }

  /** The row id is the provider idempotency key; a failure leaves it PENDING (502). */
  private async send(tenantId: string, row: Row): Promise<void> {
    let providerRefundId: string | null = null;
    const checkoutId = await this.checkoutOf(tenantId, row.attemptId);
    if (row.kind === 'REFUND') {
      const refund = await this.provider.refund(
        tenantId,
        checkoutId,
        row.paymentId,
        row.id,
        row.amountCents ?? undefined,
      );
      providerRefundId = refund.id;
    } else {
      const { status } = await this.provider.cancel(
        tenantId,
        checkoutId,
        row.id,
      );
      if (status !== 'cancelled') throw providerFailed();
    }
    await this.database.withTenant(tenantId, (tx) =>
      tx
        .update(paymentRefunds)
        .set({ status: 'SUCCEEDED', providerRefundId, updatedAt: new Date() })
        .where(
          and(
            eq(paymentRefunds.id, row.id),
            eq(paymentRefunds.status, 'PENDING'),
          ),
        ),
    );
  }

  /** Every row succeeded: finish the reservation transition. Idempotent under lock. */
  private settle(
    tenantId: string,
    actorId: string,
    reservationId: string,
    key: string,
  ): Promise<RefundResult> {
    return this.database.withTenant(tenantId, async (tx) => {
      const reservation = await this.lock(tx, reservationId);
      const rows = await this.rowsOf(tx, reservationId, key);
      let status = reservation.status;
      const full = rows.every((r) => r.amountCents === null);
      if (full && status === 'REFUND_PENDING') {
        status = await this.move(
          tx,
          actorId,
          reservationId,
          status,
          'REFUNDED',
          'reservation.refunded',
        );
        await tx
          .update(eventStands)
          .set({ status: 'AVAILABLE', updatedAt: new Date() })
          .where(
            and(
              eq(eventStands.id, reservation.eventStandId),
              eq(eventStands.status, 'ASSIGNED'),
            ),
          );
      } else if (full && status === 'PAYMENT_PENDING') {
        status = await this.move(
          tx,
          actorId,
          reservationId,
          status,
          'CANCELLED',
          'reservation.cancelled',
        );
        await tx
          .update(paymentAttempts)
          .set({ status: 'CANCELLED', updatedAt: new Date() })
          .where(
            and(
              eq(paymentAttempts.reservationId, reservationId),
              eq(paymentAttempts.status, 'PENDING'),
            ),
          );
      }
      return { reservationStatus: status, refunds: rows.map(view) };
    });
  }

  private async lock(tx: Transaction, reservationId: string): Promise<Locked> {
    const [reservation] = await tx
      .select({
        status: reservations.status,
        eventStandId: reservations.eventStandId,
      })
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .for('update');
    if (!reservation) throw new NotFoundException('Reservation not found.');
    return reservation;
  }

  private async move(
    tx: Transaction,
    actorId: string,
    reservationId: string,
    from: ReservationStatus,
    to: ReservationStatus,
    action: string,
  ): Promise<ReservationStatus> {
    await tx
      .update(reservations)
      .set({ status: to, updatedAt: new Date() })
      .where(eq(reservations.id, reservationId));
    await this.audit.record(tx, {
      actorId,
      action,
      entityType: 'reservation',
      entityId: reservationId,
      before: { status: from },
      after: {
        status: to,
        ...(to === 'CANCELLED' ? { reason: 'PAYMENT_CANCELLED' } : {}),
      },
    });
    return to;
  }
}

/** 422s: the provider refuses after 180 days; a partial refund needs one approved payment. */
function check(targets: Target[], amountCents: number | undefined): void {
  const limit = Date.now() - REFUND_WINDOW_DAYS * 86_400_000;
  if (
    targets.some(
      (t) => t.payment.approvedAt && t.payment.approvedAt.getTime() < limit,
    )
  )
    throw fail(
      UnprocessableEntityException,
      'REFUND_WINDOW_CLOSED',
      'Payments can only be refunded within 180 days.',
    );
  if (amountCents === undefined) return;
  const [only] = targets;
  if (targets.length !== 1 || only.payment.status !== 'approved')
    throw fail(
      UnprocessableEntityException,
      'PARTIAL_REFUND_AMBIGUOUS',
      'A partial refund needs one approved payment.',
    );
  if (amountCents > only.payment.amountCents)
    throw fail(
      UnprocessableEntityException,
      'REFUND_AMOUNT_INVALID',
      'The amount exceeds the payment.',
    );
}

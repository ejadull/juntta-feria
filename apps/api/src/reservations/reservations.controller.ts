import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { isUuid } from '../db/database.service.js';
import { parseBody } from '../http/parse-body.js';
import {
  MANAGERS,
  OWNERS,
  TenantScoped,
  type TenantRequest,
} from '../tenancy/tenant-scoped.decorator.js';
import { CheckoutService, type CheckoutView } from './checkout.service.js';
import {
  createReservationInput,
  listReservationsQuery,
  refundInput,
} from './reservation.input.js';
import { RefundsService, type RefundResult } from './refunds.service.js';
import {
  ReservationsService,
  type ReservationView,
} from './reservations.service.js';

/** Exhibitors only see their own reservations; managers see the organization's. */
const ownerScope = (request: TenantRequest): string | null =>
  request.tenant.role === 'EXHIBITOR' ? request.user.id : null;

function reservationId(id: string): string {
  if (!isUuid(id)) throw new NotFoundException('Reservation not found.');
  return id;
}

function idempotencyKey(request: TenantRequest): string {
  const key = request.headers['idempotency-key'];
  if (!isUuid(key))
    throw new BadRequestException(
      'An Idempotency-Key header with a UUID is required.',
    );
  return key;
}

/** RES-01 (§5): holds, reads and cancellation of reservations; PAY-02: their checkout. */
@Controller('reservations')
export class ReservationsController {
  constructor(
    private readonly reservations: ReservationsService,
    private readonly checkouts: CheckoutService,
    private readonly refunds: RefundsService,
  ) {}

  /** 201 for a new hold, 200 when the same Idempotency-Key is replayed (§5.1). */
  @Post()
  @TenantScoped('EXHIBITOR')
  async hold(
    @Req() request: TenantRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReservationView> {
    const key = idempotencyKey(request);
    const input = parseBody(createReservationInput, body, 'reservation');
    const { reservation, replayed } = await this.reservations.hold(
      request.tenant.id,
      request.user.id,
      key,
      input,
    );
    void reply.status(replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return reservation;
  }

  @Get()
  @TenantScoped(...MANAGERS, 'EXHIBITOR')
  list(
    @Req() request: TenantRequest,
    @Query() query: unknown,
  ): Promise<ReservationView[]> {
    const { eventId } = parseBody(
      listReservationsQuery,
      query,
      'reservations query',
    );
    return this.reservations.list(
      request.tenant.id,
      ownerScope(request),
      eventId,
    );
  }

  @Get(':id')
  @TenantScoped(...MANAGERS, 'EXHIBITOR')
  async get(
    @Req() request: TenantRequest,
    @Param('id') id: string,
  ): Promise<ReservationView> {
    const reservation = await this.reservations.get(
      request.tenant.id,
      reservationId(id),
      ownerScope(request),
    );
    if (!reservation) throw new NotFoundException('Reservation not found.');
    return reservation;
  }

  /** PAY-02 (§5.2): 201 when this request opens the checkout, 200 when it returns the open one. */
  @Post(':id/checkout')
  @TenantScoped('EXHIBITOR')
  async checkout(
    @Req() request: TenantRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CheckoutView> {
    const key = idempotencyKey(request);
    const { checkout, created } = await this.checkouts.checkout(
      request.tenant.id,
      request.user.id,
      reservationId(id),
      key,
    );
    void reply.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return checkout;
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @TenantScoped(...MANAGERS, 'EXHIBITOR')
  cancel(
    @Req() request: TenantRequest,
    @Param('id') id: string,
  ): Promise<ReservationView> {
    return this.reservations.cancel(
      request.tenant.id,
      request.user.id,
      reservationId(id),
      ownerScope(request),
    );
  }

  /** PAY-06: refunds approved payments and cancels pending ones; 201 new, 200 replay. */
  @Post(':id/refunds')
  @TenantScoped(...OWNERS)
  async refund(
    @Req() request: TenantRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RefundResult> {
    const key = idempotencyKey(request);
    const { amountCents } = parseBody(refundInput, body ?? {}, 'refund');
    const { result, created } = await this.refunds.refund(
      request.tenant.id,
      request.user.id,
      reservationId(id),
      key,
      amountCents,
    );
    void reply.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }
}

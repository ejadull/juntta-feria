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
  TenantScoped,
  type TenantRequest,
} from '../tenancy/tenant-scoped.decorator.js';
import { createReservationInput, listReservationsQuery } from './reservation.input.js';
import { ReservationsService, type ReservationView } from './reservations.service.js';

/** Exhibitors only see their own reservations; managers see the organization's. */
const ownerScope = (request: TenantRequest): string | null =>
  request.tenant.role === 'EXHIBITOR' ? request.user.id : null;

function reservationId(id: string): string {
  if (!isUuid(id)) throw new NotFoundException('Reservation not found.');
  return id;
}

/** RES-01 (§5): holds, reads and cancellation of reservations. */
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** 201 for a new hold, 200 when the same Idempotency-Key is replayed (§5.1). */
  @Post()
  @TenantScoped('EXHIBITOR')
  async hold(
    @Req() request: TenantRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ReservationView> {
    const key = request.headers['idempotency-key'];
    if (!isUuid(key)) throw new BadRequestException('An Idempotency-Key header with a UUID is required.');
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
  list(@Req() request: TenantRequest, @Query() query: unknown): Promise<ReservationView[]> {
    const { eventId } = parseBody(listReservationsQuery, query, 'reservations query');
    return this.reservations.list(request.tenant.id, ownerScope(request), eventId);
  }

  @Get(':id')
  @TenantScoped(...MANAGERS, 'EXHIBITOR')
  async get(@Req() request: TenantRequest, @Param('id') id: string): Promise<ReservationView> {
    const reservation = await this.reservations.get(request.tenant.id, reservationId(id), ownerScope(request));
    if (!reservation) throw new NotFoundException('Reservation not found.');
    return reservation;
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @TenantScoped(...MANAGERS, 'EXHIBITOR')
  cancel(@Req() request: TenantRequest, @Param('id') id: string): Promise<ReservationView> {
    return this.reservations.cancel(request.tenant.id, request.user.id, reservationId(id), ownerScope(request));
  }
}

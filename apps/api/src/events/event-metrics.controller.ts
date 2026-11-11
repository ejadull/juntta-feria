import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { isUuid } from '../db/database.service.js';
import {
  MANAGERS,
  TenantScoped,
  type TenantRequest,
} from '../tenancy/tenant-scoped.decorator.js';
import {
  DEFAULT_METRIC_DAYS,
  EventMetricsService,
  MAX_METRIC_DAYS,
  type EventMetrics,
} from './event-metrics.service.js';
import { EVENT_NOT_FOUND } from './events.service.js';
import { ReservationsExportService } from './reservations-export.service.js';

function daysOf(value: string | undefined): number {
  if (value === undefined) return DEFAULT_METRIC_DAYS;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > MAX_METRIC_DAYS)
    throw new BadRequestException(
      `Invalid metrics query: days must be an integer from 1 to ${MAX_METRIC_DAYS}.`,
    );
  return days;
}

/** REP-01 (spec 5): dashboard KPIs of one event, for the organizer's staff only. */
@Controller('events')
export class EventMetricsController {
  constructor(
    private readonly metrics: EventMetricsService,
    private readonly reservationsExport: ReservationsExportService,
  ) {}

  @Get(':id/metrics')
  @TenantScoped(...MANAGERS)
  get(
    @Req() request: TenantRequest,
    @Param('id') eventId: string,
    @Query('days') days?: string,
  ): Promise<EventMetrics> {
    if (!isUuid(eventId)) throw new NotFoundException(EVENT_NOT_FOUND);
    return this.metrics.get(request.tenant.id, eventId, daysOf(days));
  }

  /** REP-01: CSV of the event's reservations (UTF-8 with BOM, formula-injection safe). */
  @Get(':id/reservations/export')
  @TenantScoped(...MANAGERS)
  async exportReservations(
    @Req() request: TenantRequest,
    @Param('id') eventId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    if (!isUuid(eventId)) throw new NotFoundException(EVENT_NOT_FOUND);
    const { filename, csv } = await this.reservationsExport.export(
      request.tenant.id,
      eventId,
    );
    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'no-store');
    return csv;
  }
}

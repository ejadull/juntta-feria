import { Module } from '@nestjs/common';
import { EventInventoryService } from './event-inventory.service.js';
import { EventMetricsController } from './event-metrics.controller.js';
import { EventMetricsService } from './event-metrics.service.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';
import { ReservationsExportService } from './reservations-export.service.js';

/**
 * EVT-01: events, priced stands and sectors (§2.1 EventsModule, EventStandsModule, PricingModule);
 * REP-01: the dashboard metrics read model.
 */
@Module({
  controllers: [EventsController, EventMetricsController],
  providers: [
    EventsService,
    EventInventoryService,
    EventMetricsService,
    ReservationsExportService,
  ],
})
export class EventsModule {}

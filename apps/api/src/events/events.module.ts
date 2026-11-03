import { Module } from '@nestjs/common';
import { EventInventoryService } from './event-inventory.service.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';

/** EVT-01: events, priced stands and sectors (§2.1 EventsModule, EventStandsModule, PricingModule). */
@Module({
  controllers: [EventsController],
  providers: [EventsService, EventInventoryService],
})
export class EventsModule {}

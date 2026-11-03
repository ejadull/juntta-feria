import { Module } from '@nestjs/common';
import { VenuesController } from './venues.controller.js';
import { VenuesService } from './venues.service.js';

/** VEN-01: fixed and temporary venues of a tenant (§2.1 VenuesModule). */
@Module({
  controllers: [VenuesController],
  providers: [VenuesService],
})
export class VenuesModule {}

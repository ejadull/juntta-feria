import { Module } from '@nestjs/common';
import { PublicEventsController } from './public-events.controller.js';
import { PublicEventsService } from './public-events.service.js';

/** PUB-01: public catalog, map and directory (spec 2.1 PublicCatalogModule). No authentication. */
@Module({
  controllers: [PublicEventsController],
  providers: [PublicEventsService],
})
export class PublicModule {}

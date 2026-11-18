import { Module } from '@nestjs/common';
import { RateLimitModule } from '../http/rate-limit.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { PublicEventsController } from './public-events.controller.js';
import { PublicEventsService } from './public-events.service.js';
import { PublicShareController } from './public-share.controller.js';
import { PublicShareService } from './public-share.service.js';

/** PUB-01: public catalog, map and directory (spec 2.1 PublicCatalogModule). No authentication. */
@Module({
  imports: [RateLimitModule, StorageModule],
  controllers: [PublicEventsController, PublicShareController],
  providers: [PublicEventsService, PublicShareService],
})
export class PublicModule {}

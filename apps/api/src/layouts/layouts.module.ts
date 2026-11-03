import { Module } from '@nestjs/common';
import { LayoutTemplatesController, LayoutVersionsController } from './layouts.controller.js';
import { LayoutsService } from './layouts.service.js';

/** LAY-01: versioned floor plans (§2.1 LayoutsModule). */
@Module({
  controllers: [LayoutTemplatesController, LayoutVersionsController],
  providers: [LayoutsService],
})
export class LayoutsModule {}

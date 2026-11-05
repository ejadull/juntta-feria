import { Module } from '@nestjs/common';
import {
  ExhibitorsController,
  MyExhibitorProfileController,
} from './exhibitors.controller.js';
import { ExhibitorsService } from './exhibitors.service.js';

/** EXH-01: exhibitor profiles (§2.1 ExhibitorsModule). */
@Module({
  controllers: [MyExhibitorProfileController, ExhibitorsController],
  providers: [ExhibitorsService],
})
export class ExhibitorsModule {}

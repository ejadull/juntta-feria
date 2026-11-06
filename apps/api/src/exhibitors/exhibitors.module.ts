import { Module } from '@nestjs/common';
import {
  ExhibitorsController,
  MyExhibitorProfileController,
} from './exhibitors.controller.js';
import { ExhibitorsService } from './exhibitors.service.js';
import {
  InvitationsController,
  PublicInvitationsController,
} from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';

/** EXH-01 exhibitor profiles and EXH-04 invitations (§2.1 ExhibitorsModule). */
@Module({
  controllers: [
    MyExhibitorProfileController,
    ExhibitorsController,
    InvitationsController,
    PublicInvitationsController,
  ],
  providers: [ExhibitorsService, InvitationsService],
})
export class ExhibitorsModule {}

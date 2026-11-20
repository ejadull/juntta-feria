import { Module } from '@nestjs/common';
import { RateLimitModule } from '../http/rate-limit.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import {
  ExhibitorDocumentsController,
  MyDocumentsController,
} from './documents.controller.js';
import { ExhibitorDocumentsSweeper } from './document-sweeper.service.js';
import { ExhibitorDocumentsService } from './documents.service.js';
import {
  ExhibitorsController,
  MyExhibitorProfileController,
} from './exhibitors.controller.js';
import { ExhibitorPhotosSweeper } from './photo-sweeper.service.js';
import { MyPhotosController } from './photos.controller.js';
import { ExhibitorPhotosService } from './photos.service.js';
import { ExhibitorsService } from './exhibitors.service.js';
import {
  InvitationsController,
  PublicInvitationsController,
} from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { EventPublicationsController } from './publication-moderation.controller.js';
import { PublicationModerationService } from './publication-moderation.service.js';
import { PublicationRetentionSweeper } from './publication-retention.service.js';

/**
 * EXH-01 exhibitor profiles, EXH-02 rubros, EXH-03 documents and EXH-04 invitations
 * (§2.1 ExhibitorsModule).
 */
@Module({
  imports: [StorageModule, RateLimitModule],
  controllers: [
    CategoriesController,
    MyDocumentsController,
    MyPhotosController,
    ExhibitorDocumentsController,
    MyExhibitorProfileController,
    ExhibitorsController,
    InvitationsController,
    PublicInvitationsController,
    EventPublicationsController,
  ],
  providers: [
    PublicationModerationService,
    PublicationRetentionSweeper,
    ExhibitorsService,
    InvitationsService,
    CategoriesService,
    ExhibitorDocumentsService,
    ExhibitorPhotosService,
    ExhibitorDocumentsSweeper,
    ExhibitorPhotosSweeper,
  ],
})
export class ExhibitorsModule {}

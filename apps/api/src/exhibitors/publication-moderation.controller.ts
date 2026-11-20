import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { isUuid } from '../db/database.service.js';
import { parseBody } from '../http/parse-body.js';
import {
  MANAGERS,
  TenantScoped,
  type TenantRequest,
} from '../tenancy/tenant-scoped.decorator.js';
import {
  PublicationModerationService,
  type OrganizerPublication,
} from './publication-moderation.service.js';

/** Body of `PATCH /events/:id/publications/:photoId`: hide (true) or show (false). */
export const setVisibilityInput = z.strictObject({ hidden: z.boolean() });

const uuid = (value: string, message: string): string => {
  if (!isUuid(value)) throw new NotFoundException(message);
  return value;
};

/** Organizers and operators moderate the publications of their own events (MED-11). */
@Controller('events')
export class EventPublicationsController {
  constructor(private readonly service: PublicationModerationService) {}

  @Get(':id/publications')
  @TenantScoped(...MANAGERS)
  list(
    @Req() request: TenantRequest,
    @Param('id') id: string,
  ): Promise<OrganizerPublication[]> {
    return this.service.listForEvent(request.tenant.id, uuid(id, 'Event not found.'));
  }

  @Patch(':id/publications/:photoId')
  @TenantScoped(...MANAGERS)
  setHidden(
    @Req() request: TenantRequest,
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Body() body: unknown,
  ): Promise<OrganizerPublication> {
    const { hidden } = parseBody(setVisibilityInput, body, 'publication');
    return this.service.setHidden(
      request.tenant.id,
      request.user.id,
      uuid(id, 'Event not found.'),
      uuid(photoId, 'Publication not found.'),
      hidden,
    );
  }
}

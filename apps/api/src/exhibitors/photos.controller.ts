import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { isUuid } from '../db/database.service.js';
import { parseBody } from '../http/parse-body.js';
import {
  TenantScoped,
  type TenantRequest,
} from '../tenancy/tenant-scoped.decorator.js';
import { requestPhotoInput, updateCaptionInput } from './photo.input.js';
import {
  ExhibitorPhotosService,
  type ExhibitorPhoto,
  type PhotoUploadTicket,
} from './photos.service.js';

const photoId = (value: string): string => {
  if (!isUuid(value)) throw new NotFoundException('Photo not found.');
  return value;
};

/** The exhibitor's own stand photos. Upload goes browser -> storage, never through the API. */
@Controller('exhibitors/me/photos')
export class MyPhotosController {
  constructor(private readonly photos: ExhibitorPhotosService) {}

  @Get()
  @TenantScoped('EXHIBITOR')
  list(@Req() request: TenantRequest): Promise<ExhibitorPhoto[]> {
    return this.photos.listOwn(request.tenant.id, request.user.id);
  }

  @Post()
  @TenantScoped('EXHIBITOR')
  requestUpload(
    @Req() request: TenantRequest,
    @Body() body: unknown,
  ): Promise<PhotoUploadTicket> {
    return this.photos.requestUpload(
      request.tenant.id,
      request.user.id,
      parseBody(requestPhotoInput, body, 'photo'),
    );
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @TenantScoped('EXHIBITOR')
  complete(
    @Req() request: TenantRequest,
    @Param('id') id: string,
  ): Promise<ExhibitorPhoto> {
    return this.photos.complete(
      request.tenant.id,
      request.user.id,
      photoId(id),
    );
  }

  @Patch(':id')
  @TenantScoped('EXHIBITOR')
  updateCaption(
    @Req() request: TenantRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ExhibitorPhoto> {
    const { caption } = parseBody(updateCaptionInput, body, 'publication');
    return this.photos.updateCaption(
      request.tenant.id,
      request.user.id,
      photoId(id),
      caption,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @TenantScoped('EXHIBITOR')
  remove(
    @Req() request: TenantRequest,
    @Param('id') id: string,
  ): Promise<void> {
    return this.photos.removeOwn(
      request.tenant.id,
      request.user.id,
      photoId(id),
    );
  }
}

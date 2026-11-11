import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { isUuid } from '../db/database.service.js';
import { parseBody } from '../http/parse-body.js';
import {
  MANAGERS,
  TenantScoped,
  type TenantRequest,
} from '../tenancy/tenant-scoped.decorator.js';
import { requestUploadInput, reviewInput } from './document.input.js';
import {
  ExhibitorDocumentsService,
  type DownloadTicket,
  type ExhibitorDocument,
  type UploadTicket,
} from './documents.service.js';

const uuid = (value: string, message: string): string => {
  if (!isUuid(value)) throw new NotFoundException(message);
  return value;
};
const docId = (value: string) => uuid(value, 'Document not found.');
const exhibitorId = (value: string) => uuid(value, 'Exhibitor not found.');

/** EXH-03: the exhibitor's own documents (§5). Upload goes browser -> storage, never through the API. */
@Controller('exhibitors/me/documents')
export class MyDocumentsController {
  constructor(private readonly documents: ExhibitorDocumentsService) {}

  @Get()
  @TenantScoped('EXHIBITOR')
  list(@Req() request: TenantRequest): Promise<ExhibitorDocument[]> {
    return this.documents.listOwn(request.tenant.id, request.user.id);
  }

  @Post()
  @TenantScoped('EXHIBITOR')
  requestUpload(
    @Req() request: TenantRequest,
    @Body() body: unknown,
  ): Promise<UploadTicket> {
    return this.documents.requestUpload(
      request.tenant.id,
      request.user.id,
      parseBody(requestUploadInput, body, 'document'),
    );
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @TenantScoped('EXHIBITOR')
  complete(
    @Req() request: TenantRequest,
    @Param('id') id: string,
  ): Promise<ExhibitorDocument> {
    return this.documents.complete(
      request.tenant.id,
      request.user.id,
      docId(id),
    );
  }

  @Get(':id/download')
  @TenantScoped('EXHIBITOR')
  download(
    @Req() request: TenantRequest,
    @Param('id') id: string,
  ): Promise<DownloadTicket> {
    return this.documents.downloadOwn(
      request.tenant.id,
      request.user.id,
      docId(id),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @TenantScoped('EXHIBITOR')
  remove(
    @Req() request: TenantRequest,
    @Param('id') id: string,
  ): Promise<void> {
    return this.documents.removeOwn(
      request.tenant.id,
      request.user.id,
      docId(id),
    );
  }
}

/** EXH-03: documents of any exhibitor of the organization, for its organizers (§5). */
@Controller('exhibitors/:id/documents')
export class ExhibitorDocumentsController {
  constructor(private readonly documents: ExhibitorDocumentsService) {}

  @Get()
  @TenantScoped(...MANAGERS)
  list(
    @Req() request: TenantRequest,
    @Param('id') id: string,
  ): Promise<ExhibitorDocument[]> {
    return this.documents.listForExhibitor(request.tenant.id, exhibitorId(id));
  }

  @Get(':docId/download')
  @TenantScoped(...MANAGERS)
  download(
    @Req() request: TenantRequest,
    @Param('id') id: string,
    @Param('docId') doc: string,
  ): Promise<DownloadTicket> {
    return this.documents.downloadForStaff(
      request.tenant.id,
      exhibitorId(id),
      docId(doc),
    );
  }

  @Post(':docId/review')
  @HttpCode(HttpStatus.OK)
  @TenantScoped(...MANAGERS)
  review(
    @Req() request: TenantRequest,
    @Param('id') id: string,
    @Param('docId') doc: string,
    @Body() body: unknown,
  ): Promise<ExhibitorDocument> {
    return this.documents.review(
      request.tenant.id,
      request.user.id,
      exhibitorId(id),
      docId(doc),
      parseBody(reviewInput, body, 'review'),
    );
  }
}

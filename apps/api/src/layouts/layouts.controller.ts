import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { isUuid } from '../db/database.service.js';
import { parseBody } from '../http/parse-body.js';
import {
  MANAGERS,
  OWNERS,
  TenantScoped,
  type TenantRequest,
} from '../tenancy/tenant-scoped.decorator.js';
import {
  cloneTemplateInput,
  cloneVersionInput,
  createTemplateInput,
  saveObjectsInput,
} from './layout.input.js';
import {
  LayoutsService,
  type LayoutTemplateSummary,
  type LayoutVersionDto,
} from './layouts.service.js';

/** A malformed id is just another layout that does not exist (uniform 404). */
function layoutId(id: string): string {
  if (!isUuid(id)) throw new NotFoundException('Layout not found.');
  return id;
}

@Controller('layout-templates')
export class LayoutTemplatesController {
  constructor(private readonly layouts: LayoutsService) {}

  @Get()
  @TenantScoped(...MANAGERS)
  list(@Req() request: TenantRequest): Promise<LayoutTemplateSummary[]> {
    return this.layouts.listTemplates(request.tenant.id);
  }

  /** Creates the template and its first draft, which is what the editor opens. */
  @Post()
  @TenantScoped(...MANAGERS)
  create(
    @Req() request: TenantRequest,
    @Body() body: unknown,
  ): Promise<LayoutVersionDto> {
    const input = parseBody(createTemplateInput, body, 'layout template');
    return this.layouts.createTemplate(
      request.tenant.id,
      request.user.id,
      input,
    );
  }

  /**
   * "Clonar plano": copies a version (any status) into a NEW template whose first version is a
   * draft with new object ids. An event keeps its version; to use a changed plan you clone it
   * (or its next version) and create a new event.
   */
  @Post(':id/clone')
  @TenantScoped(...MANAGERS)
  cloneTemplate(
    @Req() request: TenantRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<LayoutVersionDto> {
    const templateId = layoutId(id);
    const input = parseBody(cloneTemplateInput, body, 'layout template');
    return this.layouts.cloneTemplate(
      request.tenant.id,
      request.user.id,
      templateId,
      input,
    );
  }

  @Post(':id/versions')
  @TenantScoped(...MANAGERS)
  clone(
    @Req() request: TenantRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<LayoutVersionDto> {
    const templateId = layoutId(id);
    const { sourceVersionId } = parseBody(
      cloneVersionInput,
      body,
      'layout version',
    );
    return this.layouts.cloneVersion(
      request.tenant.id,
      request.user.id,
      templateId,
      sourceVersionId,
    );
  }
}

@Controller('layout-versions')
export class LayoutVersionsController {
  constructor(private readonly layouts: LayoutsService) {}

  /**
   * Exhibitors read the plan of a published or archived version (stand map): an event keeps the
   * version it was created on, which is archived when a newer one is published. Drafts stay
   * organizer-only.
   */
  @Get(':id')
  @TenantScoped(...MANAGERS, 'EXHIBITOR')
  async get(
    @Req() request: TenantRequest,
    @Param('id') id: string,
  ): Promise<LayoutVersionDto> {
    const version = await this.layouts.getVersion(
      request.tenant.id,
      layoutId(id),
    );
    if (
      !version ||
      (request.tenant.role === 'EXHIBITOR' && version.status === 'DRAFT')
    )
      throw new NotFoundException('Layout not found.');
    return version;
  }

  @Put(':id/objects')
  @TenantScoped(...MANAGERS)
  save(
    @Req() request: TenantRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<LayoutVersionDto> {
    const versionId = layoutId(id);
    const { objects } = parseBody(saveObjectsInput, body, 'layout');
    return this.layouts.saveObjects(
      request.tenant.id,
      request.user.id,
      versionId,
      objects,
    );
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @TenantScoped(...OWNERS)
  publish(
    @Req() request: TenantRequest,
    @Param('id') id: string,
  ): Promise<LayoutVersionDto> {
    return this.layouts.publish(
      request.tenant.id,
      request.user.id,
      layoutId(id),
    );
  }
}

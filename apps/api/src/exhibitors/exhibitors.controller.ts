import {
  Body,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { isUuid } from '../db/database.service.js';
import { parseBody } from '../http/parse-body.js';
import {
  MANAGERS,
  TenantScoped,
  type TenantRequest,
} from '../tenancy/tenant-scoped.decorator.js';
import { exhibitorProfileInput } from './exhibitor.input.js';
import {
  ExhibitorsService,
  type ExhibitorProfile,
  type ExhibitorSummary,
} from './exhibitors.service.js';

const PROFILE_NOT_FOUND =
  'You have no exhibitor profile in this organization yet.';
const NOT_FOUND = 'Exhibitor not found.';

/** The exhibitor member's own profile in the organization of X-Tenant-Id (EXH-01). */
@Controller('me/exhibitor-profile')
export class MyExhibitorProfileController {
  constructor(private readonly exhibitors: ExhibitorsService) {}

  @Get()
  @TenantScoped('EXHIBITOR')
  async get(@Req() request: TenantRequest): Promise<ExhibitorProfile> {
    const profile = await this.exhibitors.getOwn(
      request.tenant.id,
      request.user.id,
    );
    if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
    return profile;
  }

  /** 201 the first time, 200 afterwards. */
  @Put()
  @TenantScoped('EXHIBITOR')
  async save(
    @Req() request: TenantRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ExhibitorProfile> {
    const input = parseBody(exhibitorProfileInput, body, 'exhibitor profile');
    const { profile, created } = await this.exhibitors.saveOwn(
      request.tenant.id,
      request.user.id,
      input,
    );
    void reply.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return profile;
  }
}

/** Organizer view with private data (§5, D4 of org-ui-shell); never used by public views. */
@Controller('exhibitors')
export class ExhibitorsController {
  constructor(private readonly exhibitors: ExhibitorsService) {}

  @Get()
  @TenantScoped(...MANAGERS)
  list(@Req() request: TenantRequest): Promise<ExhibitorSummary[]> {
    return this.exhibitors.list(request.tenant.id);
  }

  @Get(':id')
  @TenantScoped(...MANAGERS)
  async get(
    @Req() request: TenantRequest,
    @Param('id') id: string,
  ): Promise<ExhibitorSummary> {
    const exhibitor = isUuid(id)
      ? await this.exhibitors.get(request.tenant.id, id)
      : null;
    if (!exhibitor) throw new NotFoundException(NOT_FOUND);
    return exhibitor;
  }
}

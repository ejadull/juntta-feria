import {
  BadRequestException,
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
import type { z } from 'zod';
import { isUuid } from '../db/database.service.js';
import type { MembershipRole } from '../db/schema.js';
import { TenantScoped, type TenantRequest } from '../tenancy/tenant-scoped.decorator.js';
import { createVenueInput, updateVenueInput } from './venue.input.js';
import { VenuesService, type Venue } from './venues.service.js';

/** Who manages venues (§5 "owner/operator"; ADMIN is the owner's delegate, §1.3). */
const MANAGERS: [MembershipRole, ...MembershipRole[]] = ['OWNER', 'ADMIN', 'OPERATOR'];

const NOT_FOUND = 'Venue not found.';

/** Names the invalid fields, never echoes the received values. */
function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const fields = [...new Set(result.error.issues.map((i) => i.path.join('.') || 'body'))];
  throw new BadRequestException(`Invalid venue: ${fields.join(', ')}.`);
}

/** A malformed id is just another venue that does not exist (uniform 404). */
function venueId(id: string): string {
  if (!isUuid(id)) throw new NotFoundException(NOT_FOUND);
  return id;
}

const found = (venue: Venue | null): Venue => {
  if (!venue) throw new NotFoundException(NOT_FOUND);
  return venue;
};

@Controller('venues')
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  @Get()
  @TenantScoped(...MANAGERS)
  list(@Req() request: TenantRequest): Promise<Venue[]> {
    return this.venues.list(request.tenant.id);
  }

  @Get(':id')
  @TenantScoped(...MANAGERS)
  async get(@Req() request: TenantRequest, @Param('id') id: string): Promise<Venue> {
    return found(await this.venues.get(request.tenant.id, venueId(id)));
  }

  @Post()
  @TenantScoped(...MANAGERS)
  create(@Req() request: TenantRequest, @Body() body: unknown): Promise<Venue> {
    return this.venues.create(request.tenant.id, request.user.id, parse(createVenueInput, body));
  }

  @Patch(':id')
  @TenantScoped(...MANAGERS)
  async update(
    @Req() request: TenantRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<Venue> {
    const venue = venueId(id);
    const patch = parse(updateVenueInput, body);
    return found(await this.venues.update(request.tenant.id, request.user.id, venue, patch));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @TenantScoped('OWNER', 'ADMIN')
  async remove(@Req() request: TenantRequest, @Param('id') id: string): Promise<void> {
    const removed = await this.venues.remove(request.tenant.id, request.user.id, venueId(id));
    if (!removed) throw new NotFoundException(NOT_FOUND);
  }
}

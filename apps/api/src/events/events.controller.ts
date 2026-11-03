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
  MANAGERS,
  OWNERS,
  TenantScoped,
  type TenantRequest,
} from '../tenancy/tenant-scoped.decorator.js';
import {
  createEventInput,
  createSectorInput,
  updateEventInput,
  updateSectorInput,
  updateStandsInput,
} from './event.input.js';
import {
  EventInventoryService,
  type EventSector,
  type EventStand,
} from './event-inventory.service.js';
import { EVENT_NOT_FOUND, EventsService, type Event } from './events.service.js';

/** A malformed id is just another resource that does not exist (uniform 404). */
function id(value: string, message = EVENT_NOT_FOUND): string {
  if (!isUuid(value)) throw new NotFoundException(message);
  return value;
}

const found = (event: Event | null): Event => {
  if (!event) throw new NotFoundException(EVENT_NOT_FOUND);
  return event;
};

/** EVT-01 (§5): events, their priced stands and their sectors (ADR 0002). */
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly inventory: EventInventoryService,
  ) {}

  @Get()
  @TenantScoped(...MANAGERS)
  list(@Req() request: TenantRequest): Promise<Event[]> {
    return this.events.list(request.tenant.id);
  }

  @Post()
  @TenantScoped(...MANAGERS)
  create(@Req() request: TenantRequest, @Body() body: unknown): Promise<Event> {
    const input = parseBody(createEventInput, body, 'event');
    return this.events.create(request.tenant.id, request.user.id, input);
  }

  @Get(':id')
  @TenantScoped(...MANAGERS)
  async get(@Req() request: TenantRequest, @Param('id') eventId: string): Promise<Event> {
    return found(await this.events.get(request.tenant.id, id(eventId)));
  }

  @Patch(':id')
  @TenantScoped(...MANAGERS)
  async update(
    @Req() request: TenantRequest,
    @Param('id') eventId: string,
    @Body() body: unknown,
  ): Promise<Event> {
    const target = id(eventId);
    const patch = parseBody(updateEventInput, body, 'event');
    return found(await this.events.update(request.tenant.id, request.user.id, target, patch));
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @TenantScoped(...OWNERS)
  publish(@Req() request: TenantRequest, @Param('id') eventId: string): Promise<Event> {
    return this.events.publish(request.tenant.id, request.user.id, id(eventId));
  }

  @Get(':id/stands')
  @TenantScoped(...MANAGERS)
  stands(@Req() request: TenantRequest, @Param('id') eventId: string): Promise<EventStand[]> {
    return this.inventory.listStands(request.tenant.id, id(eventId));
  }

  @Patch(':id/stands')
  @TenantScoped(...MANAGERS)
  updateStands(
    @Req() request: TenantRequest,
    @Param('id') eventId: string,
    @Body() body: unknown,
  ): Promise<EventStand[]> {
    const target = id(eventId);
    const patch = parseBody(updateStandsInput, body, 'stands update');
    return this.inventory.updateStands(request.tenant.id, request.user.id, target, patch);
  }

  @Get(':id/sectors')
  @TenantScoped(...MANAGERS)
  sectors(@Req() request: TenantRequest, @Param('id') eventId: string): Promise<EventSector[]> {
    return this.inventory.listSectors(request.tenant.id, id(eventId));
  }

  @Post(':id/sectors')
  @TenantScoped(...MANAGERS)
  createSector(
    @Req() request: TenantRequest,
    @Param('id') eventId: string,
    @Body() body: unknown,
  ): Promise<EventSector> {
    const target = id(eventId);
    const input = parseBody(createSectorInput, body, 'sector');
    return this.inventory.createSector(request.tenant.id, request.user.id, target, input);
  }

  @Patch(':id/sectors/:sectorId')
  @TenantScoped(...MANAGERS)
  updateSector(
    @Req() request: TenantRequest,
    @Param('id') eventId: string,
    @Param('sectorId') sectorId: string,
    @Body() body: unknown,
  ): Promise<EventSector> {
    const [event, sector] = [id(eventId), id(sectorId, 'Sector not found.')];
    const patch = parseBody(updateSectorInput, body, 'sector');
    return this.inventory.updateSector(request.tenant.id, request.user.id, event, sector, patch);
  }

  @Delete(':id/sectors/:sectorId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @TenantScoped(...MANAGERS)
  removeSector(
    @Req() request: TenantRequest,
    @Param('id') eventId: string,
    @Param('sectorId') sectorId: string,
  ): Promise<void> {
    const [event, sector] = [id(eventId), id(sectorId, 'Sector not found.')];
    return this.inventory.removeSector(request.tenant.id, request.user.id, event, sector);
  }
}

import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
} from '@nestjs/common';
import {
  PUBLIC_EVENT_NOT_FOUND,
  PublicEventsService,
  type PublicEventDetail,
  type PublicEventSummary,
  type PublicExhibitor,
  type PublicMap,
} from './public-events.service.js';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG = 200;
/** Catalog data changes rarely; availability (the map) needs a much shorter TTL (spec 5.3). */
const CATALOG_CACHE = 'public, max-age=60';
const AVAILABILITY_CACHE = 'public, max-age=15';

/** A malformed slug is just another event that does not exist. */
const slugOf = (value: string): string => {
  if (value.length > MAX_SLUG || !SLUG.test(value))
    throw new NotFoundException(PUBLIC_EVENT_NOT_FOUND);
  return value;
};

/**
 * PUB-01 (spec 5): unauthenticated, read-only portal. Exposes published events only; see
 * PublicEventsService for the exact projection.
 */
@Controller('public/events')
export class PublicEventsController {
  constructor(private readonly service: PublicEventsService) {}

  @Get()
  @Header('Cache-Control', CATALOG_CACHE)
  list(): Promise<PublicEventSummary[]> {
    return this.service.list();
  }

  @Get(':slug')
  @Header('Cache-Control', CATALOG_CACHE)
  detail(@Param('slug') slug: string): Promise<PublicEventDetail> {
    return this.service.detail(slugOf(slug));
  }

  @Get(':slug/map')
  @Header('Cache-Control', AVAILABILITY_CACHE)
  map(@Param('slug') slug: string): Promise<PublicMap> {
    return this.service.map(slugOf(slug));
  }

  @Get(':slug/exhibitors')
  @Header('Cache-Control', CATALOG_CACHE)
  exhibitors(@Param('slug') slug: string): Promise<PublicExhibitor[]> {
    return this.service.exhibitors(slugOf(slug));
  }
}

import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { isUuid } from '../db/database.service.js';
import { RateLimit, RateLimitGuard } from '../http/rate-limit.guard.js';
import { renderSharePage } from './share-page.js';
import { PublicShareService, type SharedMedia } from './public-share.service.js';

export const SHARE_NOT_FOUND = 'Publication not found.';

/** Title and description of a publication, as WhatsApp and Facebook show them. */
export function shareTextsOf(media: SharedMedia): { title: string; description: string } {
  const who = `${media.exhibitorName} · ${media.eventName}`;
  return {
    title: media.caption ? `${media.caption} · ${who}` : who,
    description: media.caption ?? `Publicación de ${media.exhibitorName} en ${media.eventName}.`,
  };
}

/**
 * MED-05: the link of one publication. A missing, hidden, unconsented or ended publication answers
 * the same 404, so the link does not reveal which ones exist.
 */
@Controller('public/share')
@UseGuards(RateLimitGuard)
@RateLimit('public')
export class PublicShareController {
  constructor(private readonly service: PublicShareService) {}

  @Get(':mediaId')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  async show(
    @Param('mediaId') mediaId: string,
    @Req() request: FastifyRequest,
  ): Promise<string> {
    if (!isUuid(mediaId)) throw new NotFoundException(SHARE_NOT_FOUND);
    const media = await this.service.find(mediaId);
    if (!media) throw new NotFoundException(SHARE_NOT_FOUND);
    const origin = `${request.protocol}://${request.hostname}`;
    const file = { url: media.url, type: media.contentType };
    return renderSharePage({
      ...shareTextsOf(media),
      pageUrl: `${origin}/api/v1/public/share/${media.id}`,
      redirectUrl: `${origin}/ferias/${media.eventSlug}?publicacion=${media.id}`,
      image: media.kind === 'IMAGE' ? file : null,
      video: media.kind === 'VIDEO' ? file : null,
    });
  }
}

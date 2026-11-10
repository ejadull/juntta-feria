import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  AccessTokenGuard,
  type AuthenticatedRequest,
} from '../auth/access-token.guard.js';
import { isUuid } from '../db/database.service.js';
import { parseBody } from '../http/parse-body.js';
import { startSubscriptionInput } from './platform-subscription.input.js';
import {
  PlatformSubscriptionsService,
  type SubscriptionView,
} from './platform-subscriptions.service.js';

/**
 * EXH-05 (§5): the exhibitor's subscription to the platform. Not tenant-scoped: it is global per
 * user, so there is no `X-Tenant-Id`.
 */
@Controller('me/subscription')
@UseGuards(AccessTokenGuard)
export class PlatformSubscriptionsController {
  constructor(private readonly subscriptions: PlatformSubscriptionsService) {}

  @Get()
  get(@Req() request: AuthenticatedRequest): Promise<SubscriptionView> {
    return this.subscriptions.get(request.user.id);
  }

  /** 201 when this request creates the preapproval, 200 when it returns the pending one. */
  @Post()
  async start(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SubscriptionView> {
    const key = request.headers['idempotency-key'];
    if (!isUuid(key))
      throw new BadRequestException(
        'An Idempotency-Key header with a UUID is required.',
      );
    const { payerEmail } = parseBody(
      startSubscriptionInput,
      body ?? {},
      'subscription',
    );
    const { subscription, created } = await this.subscriptions.start(
      request.user.id,
      payerEmail,
      key,
    );
    void reply.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return subscription;
  }

  @Delete()
  cancel(@Req() request: AuthenticatedRequest): Promise<SubscriptionView> {
    return this.subscriptions.cancel(request.user.id);
  }
}

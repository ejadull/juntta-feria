import { BadRequestException, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { MercadoPagoWebhooksService } from './mercadopago-webhooks.service.js';

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

interface WebhookBody {
  readonly type?: unknown;
}

/**
 * Public endpoint for Mercado Pago (PAY-03, §5). Authenticated by `x-signature`, not by a
 * session: 401 without processing when it does not verify. Answers 200 before applying.
 */
@Controller('webhooks/mercadopago')
export class MercadoPagoWebhooksController {
  constructor(private readonly webhooks: MercadoPagoWebhooksService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() request: FastifyRequest): Promise<{ received: true }> {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const body = (request.body ?? {}) as WebhookBody;
    // The signed manifest uses `data.id` from the query (ADR 0006 §3).
    const dataId = text(query['data.id']);
    if (!dataId) throw new BadRequestException('data.id is required.');
    const inboxId = await this.webhooks.receive({
      signature: text(request.headers['x-signature']),
      requestId: text(request.headers['x-request-id']),
      dataId,
      topic: text(query.type) ?? text(query.topic) ?? text(body.type) ?? 'unknown',
      tenant: text(query.tenant),
    });
    if (inboxId) void this.webhooks.process(inboxId);
    return { received: true };
  }
}

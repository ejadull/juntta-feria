import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { parseBody } from '../http/parse-body.js';
import {
  OWNERS,
  TenantScoped,
  type TenantRequest,
} from '../tenancy/tenant-scoped.decorator.js';
import {
  SellerAccountsService,
  type SellerAccountView,
} from './seller-accounts.service.js';

/** What the redirect brought back to the web (P12): the provider code and our sealed state. */
const linkInput = z.strictObject({
  code: z.string().trim().min(1).max(512),
  state: z.string().trim().min(1).max(4096),
});

/** P12 (PAY-07): the organization's Mercado Pago seller account. Owners and admins only. */
@Controller('payment-account')
export class PaymentAccountController {
  constructor(private readonly accounts: SellerAccountsService) {}

  @Get()
  @TenantScoped(...OWNERS)
  status(@Req() request: TenantRequest): Promise<SellerAccountView> {
    return this.accounts.status(request.tenant.id);
  }

  /** Starts the OAuth flow: the web navigates to the returned URL. */
  @Post('authorization')
  @TenantScoped(...OWNERS)
  authorize(@Req() request: TenantRequest): { authorizationUrl: string } {
    return this.accounts.authorize(request.tenant.id, request.user.id);
  }

  @Post('link')
  @HttpCode(HttpStatus.OK)
  @TenantScoped(...OWNERS)
  link(
    @Req() request: TenantRequest,
    @Body() body: unknown,
  ): Promise<SellerAccountView> {
    const { code, state } = parseBody(linkInput, body, 'link');
    return this.accounts.link(request.tenant.id, request.user.id, code, state);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @TenantScoped(...OWNERS)
  unlink(@Req() request: TenantRequest): Promise<void> {
    return this.accounts.unlink(request.tenant.id, request.user.id);
  }
}

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
import {
  acceptInvitationInput,
  createInvitationInput,
  invitationToken,
} from './invitation.input.js';
import {
  InvitationsService,
  type CreatedInvitation,
  type InvitationSummary,
  type PublicInvitation,
} from './invitations.service.js';

/** Organizer side (EXH-04): create, list and revoke invitations. */
@Controller('exhibitor-invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @TenantScoped(...MANAGERS)
  create(@Req() request: TenantRequest, @Body() body: unknown): Promise<CreatedInvitation> {
    const input = parseBody(createInvitationInput, body ?? {}, 'invitation');
    return this.invitations.create(request.tenant.id, request.user.id, input);
  }

  @Get()
  @TenantScoped(...MANAGERS)
  list(@Req() request: TenantRequest): Promise<InvitationSummary[]> {
    return this.invitations.list(request.tenant.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @TenantScoped(...MANAGERS)
  revoke(@Req() request: TenantRequest, @Param('id') id: string): Promise<void> {
    if (!isUuid(id)) throw new NotFoundException('Invitation not found.');
    return this.invitations.revoke(request.tenant.id, request.user.id, id);
  }
}

/**
 * Public side: whoever holds the link. No session and no tenant header; the 256-bit token is
 * the credential. A malformed, used, revoked or expired token gets the same 404.
 */
@Controller('public/invitations')
export class PublicInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get(':token')
  show(@Param('token') token: string): Promise<PublicInvitation> {
    return this.invitations.show(validToken(token));
  }

  @Post(':token/accept')
  accept(@Param('token') token: string, @Body() body: unknown) {
    const input = parseBody(acceptInvitationInput, body, 'account');
    return this.invitations.accept(validToken(token), input);
  }
}

function validToken(token: string): string {
  if (!invitationToken.safeParse(token).success)
    throw new NotFoundException('Invitation not found or no longer valid.');
  return token;
}

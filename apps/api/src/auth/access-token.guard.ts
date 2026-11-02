import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';

/** The authenticated user attached by AccessTokenGuard. */
export type AuthenticatedRequest = FastifyRequest & { user: { id: string } };

/** Requires `Authorization: Bearer <access token>` (ADR 0004). */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    const verified = scheme === 'Bearer' && token ? await this.auth.verifyAccessToken(token) : null;
    if (!verified) {
      void http.getResponse<FastifyReply>().header('www-authenticate', 'Bearer');
      throw new UnauthorizedException('Authentication required.');
    }
    (request as AuthenticatedRequest).user = { id: verified.userId };
    return true;
  }
}

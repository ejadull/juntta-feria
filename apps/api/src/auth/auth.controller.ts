import '@fastify/cookie'; // request.cookies / reply.setCookie typings
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { configuration, type AppConfiguration } from '../config/configuration.js';
import { AccessTokenGuard, type AuthenticatedRequest } from './access-token.guard.js';
import { AuthService, type Profile, type Session } from './auth.service.js';
import { LoginRateLimiter } from './login-rate-limiter.js';

const loginBody = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
  password: z.string().min(1).max(256),
});

const INVALID_CREDENTIALS = 'Invalid email or password.';

/**
 * Body of login/refresh as an explicit allowlist: the refresh token is never in it (only in the
 * HttpOnly cookie), and new Session fields are not exposed by accident.
 */
const publicSession = (s: Session) => ({
  accessToken: s.accessToken,
  tokenType: 'Bearer' as const,
  expiresIn: s.expiresIn,
  user: s.user,
  memberships: s.memberships,
});

@Controller('auth')
export class AuthController {
  private readonly cookiePath: string;

  constructor(
    private readonly auth: AuthService,
    private readonly limiter: LoginRateLimiter,
    @Inject(configuration.KEY) private readonly env: AppConfiguration,
  ) {
    this.cookiePath = `/${env.apiPrefix}/auth`; // the cookie never reaches other endpoints
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = loginBody.safeParse(body);
    if (!input.success) throw new BadRequestException('A valid email and a password are required.');

    const decision = await this.limiter.hit(request.ip, input.data.email).catch(() => {
      // ponytail: fail closed (no throttling store = no login); revisit if Redis HA lands.
      throw new ServiceUnavailableException('Login is temporarily unavailable.');
    });
    if (!decision.allowed) {
      void reply.header('retry-after', String(decision.retryAfterSeconds));
      throw new HttpException('Too many login attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const session = await this.auth.login(input.data.email, input.data.password);
    if (!session) throw new UnauthorizedException(INVALID_CREDENTIALS);
    await this.limiter.succeeded(input.data.email).catch(() => undefined);
    this.setRefreshCookie(reply, session.refreshToken);
    return publicSession(session);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.assertTrustedOrigin(request);
    const token = request.cookies[this.env.auth.refreshCookieName];
    const session = token ? await this.auth.refresh(token) : null;
    if (!session) {
      this.clearRefreshCookie(reply);
      throw new UnauthorizedException('Session expired. Sign in again.');
    }
    this.setRefreshCookie(reply, session.refreshToken);
    return publicSession(session);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.assertTrustedOrigin(request);
    const token = request.cookies[this.env.auth.refreshCookieName];
    if (token) await this.auth.logout(token);
    this.clearRefreshCookie(reply);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  async me(@Req() request: AuthenticatedRequest): Promise<Profile> {
    const profile = await this.auth.profile(request.user.id);
    if (!profile) throw new UnauthorizedException('Authentication required.');
    return profile;
  }

  /** Cookie-authenticated endpoints only accept the app's own origins (CSRF, ADR 0004). */
  private assertTrustedOrigin(request: FastifyRequest): void {
    const origin = request.headers.origin;
    const allowed = this.env.corsOrigins.includes('*') || (!!origin && this.env.corsOrigins.includes(origin));
    if (!origin || !allowed) throw new ForbiddenException('Request origin not allowed.');
  }

  private setRefreshCookie(reply: FastifyReply, token: string): void {
    void reply.setCookie(this.env.auth.refreshCookieName, token, {
      httpOnly: true,
      secure: this.env.auth.cookieSecure,
      sameSite: this.env.auth.cookieSameSite,
      path: this.cookiePath,
      maxAge: this.env.auth.refreshTokenTtlSeconds,
    });
  }

  private clearRefreshCookie(reply: FastifyReply): void {
    void reply.clearCookie(this.env.auth.refreshCookieName, {
      httpOnly: true,
      secure: this.env.auth.cookieSecure,
      sameSite: this.env.auth.cookieSameSite,
      path: this.cookiePath,
    });
  }
}

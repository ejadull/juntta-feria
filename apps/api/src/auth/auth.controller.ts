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
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { RateLimit, RateLimitGuard } from '../http/rate-limit.guard.js';
import {
  AccessTokenGuard,
  type AuthenticatedRequest,
} from './access-token.guard.js';
import { AuthService, type MeView, type Session } from './auth.service.js';
import {
  GOOGLE_CODES,
  GOOGLE_ID_TOKEN_VERIFIER,
  googleInvalid,
  googleUnavailable,
  verifyGoogleCredential,
  type GoogleVerifier,
} from './google-sign-in.js';
import { LoginRateLimiter, type RateDecision } from './login-rate-limiter.js';
import { passwordDisabled } from './password.js';

const googleBody = z.strictObject({ credential: z.string().min(1).max(4096) });

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
    @Inject(GOOGLE_ID_TOKEN_VERIFIER) private readonly google: GoogleVerifier,
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
    if (!this.env.auth.passwordEnabled) throw passwordDisabled();
    const input = loginBody.safeParse(body);
    if (!input.success)
      throw new BadRequestException(
        'A valid email and a password are required.',
      );

    await this.throttle(this.limiter.hit(request.ip, input.data.email), reply);

    const session = await this.auth.login(
      input.data.email,
      input.data.password,
    );
    if (!session) throw new UnauthorizedException(INVALID_CREDENTIALS);
    await this.limiter.succeeded(input.data.email).catch(() => undefined);
    this.setRefreshCookie(reply, session.refreshToken);
    return publicSession(session);
  }

  /** Public: what the web may offer on the sign-in page, so it needs no build-time configuration. */
  @Get('providers')
  @UseGuards(RateLimitGuard)
  @RateLimit('public')
  providers(): { google: { clientId: string } | null; password: boolean } {
    const clientId = this.env.google.clientId;
    return {
      google: clientId ? { clientId } : null,
      password: this.env.auth.passwordEnabled,
    };
  }

  /** Sign in with a Google ID token (CORE-05, ADR 0008): existing accounts only, same session as login. */
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleLogin(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!this.google) throw googleUnavailable();
    const input = googleBody.safeParse(body);
    if (!input.success)
      throw new BadRequestException('A Google credential is required.');

    const identity = await verifyGoogleCredential(
      this.google,
      input.data.credential,
      // No email is trusted yet: an invalid credential only counts against the IP.
      () => this.throttle(this.limiter.hitIp(request.ip), reply),
    );
    await this.throttle(this.limiter.hit(request.ip, identity.email), reply);

    const result = await this.auth.loginWithGoogle(identity);
    if (result.status === 'mismatch')
      throw new UnauthorizedException({
        message: 'This account is linked to a different Google account.',
        code: GOOGLE_CODES.mismatch,
      });
    if (result.status === 'not-registered')
      throw new ForbiddenException({
        message: 'There is no account for that email.',
        code: GOOGLE_CODES.notRegistered,
      });
    if (result.status === 'inactive') throw googleInvalid();
    await this.limiter.succeeded(identity.email).catch(() => undefined);
    this.setRefreshCookie(reply, result.session.refreshToken);
    return publicSession(result.session);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
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
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.assertTrustedOrigin(request);
    const token = request.cookies[this.env.auth.refreshCookieName];
    if (token) await this.auth.logout(token);
    this.clearRefreshCookie(reply);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  async me(@Req() request: AuthenticatedRequest): Promise<MeView> {
    const profile = await this.auth.profile(request.user.id);
    if (!profile) throw new UnauthorizedException('Authentication required.');
    return profile;
  }

  /** Fail-closed throttling shared by password and Google sign-in (429 with Retry-After). */
  private async throttle(
    attempt: Promise<RateDecision>,
    reply: FastifyReply,
  ): Promise<void> {
    // ponytail: fail closed (no throttling store = no login); revisit if Redis HA lands.
    const decision = await attempt.catch(() => {
      throw new ServiceUnavailableException(
        'Login is temporarily unavailable.',
      );
    });
    if (decision.allowed) return;
    void reply.header('retry-after', String(decision.retryAfterSeconds));
    throw new HttpException(
      'Too many login attempts. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Cookie-authenticated endpoints only accept the app's own origins (CSRF, ADR 0004). */
  private assertTrustedOrigin(request: FastifyRequest): void {
    const origin = request.headers.origin;
    const allowed =
      this.env.corsOrigins.includes('*') ||
      (!!origin && this.env.corsOrigins.includes(origin));
    if (!origin || !allowed)
      throw new ForbiddenException('Request origin not allowed.');
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

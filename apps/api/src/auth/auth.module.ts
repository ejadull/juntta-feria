import { Module } from '@nestjs/common';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { GoogleIdTokenVerifier } from './google-id-token.verifier.js';
import { GoogleKeys } from './google-keys.js';
import { GOOGLE_ID_TOKEN_VERIFIER } from './google-sign-in.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginRateLimiter, type LoginLimits } from './login-rate-limiter.js';
import { RateLimitModule } from '../http/rate-limit.module.js';
import { RedisCounterStore } from './redis-counter-store.js';

/** 5 tries per email and 20 per IP every 15 minutes (§8 rate limits). */
export const LOGIN_LIMITS: LoginLimits = {
  perEmail: 5,
  perIp: 20,
  windowSeconds: 900,
};

@Module({
  imports: [RateLimitModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenGuard,
    GoogleKeys,
    {
      provide: GOOGLE_ID_TOKEN_VERIFIER,
      inject: [configuration.KEY, GoogleKeys],
      useFactory: (env: AppConfiguration, keys: GoogleKeys) =>
        env.google.clientId
          ? new GoogleIdTokenVerifier(env.google.clientId, keys.getKey)
          : null,
    },
    {
      provide: LoginRateLimiter,
      inject: [RedisCounterStore],
      useFactory: (store: RedisCounterStore) =>
        new LoginRateLimiter(store, LOGIN_LIMITS),
    },
  ],
  exports: [AuthService, AccessTokenGuard, GOOGLE_ID_TOKEN_VERIFIER],
})
export class AuthModule {}

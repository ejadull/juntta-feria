import { Module } from '@nestjs/common';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginRateLimiter, type LoginLimits } from './login-rate-limiter.js';
import { RedisCounterStore } from './redis-counter-store.js';

/** 5 tries per email and 20 per IP every 15 minutes (§8 rate limits). */
export const LOGIN_LIMITS: LoginLimits = {
  perEmail: 5,
  perIp: 20,
  windowSeconds: 900,
};

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenGuard,
    RedisCounterStore,
    {
      provide: LoginRateLimiter,
      inject: [RedisCounterStore],
      useFactory: (store: RedisCounterStore) =>
        new LoginRateLimiter(store, LOGIN_LIMITS),
    },
  ],
  exports: [AuthService, AccessTokenGuard],
})
export class AuthModule {}

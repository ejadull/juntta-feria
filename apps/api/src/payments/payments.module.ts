import { Module } from '@nestjs/common';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { RateLimitModule } from '../http/rate-limit.module.js';
import { MercadoPagoWebhooksController } from './mercadopago-webhooks.controller.js';
import { MercadoPagoWebhooksService } from './mercadopago-webhooks.service.js';
import { MercadoPagoOAuth, OAUTH_CLIENT } from './mercadopago-oauth.js';
import { createPaymentProvider } from './payment-provider.factory.js';
import { PaymentAccountController } from './payment-account.controller.js';
import { PaymentIncidentsController } from './payment-incidents.controller.js';
import { PAYMENT_PROVIDER } from './payment-provider.js';
import { PlatformSubscriptionsController } from './platform-subscriptions.controller.js';
import { PlatformSubscriptionsService } from './platform-subscriptions.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { SellerAccountsService } from './seller-accounts.service.js';

/**
 * PAY-01: the PaymentProvider port bound to Mercado Pago (ADR 0006); PAY-03: its webhooks;
 * PAY-07: each organizer's seller account, linked by OAuth; EXH-05: the exhibitor's subscription
 * to the platform (same provider and webhook pipeline).
 */
@Module({
  imports: [RateLimitModule],
  controllers: [
    MercadoPagoWebhooksController,
    PaymentIncidentsController,
    PaymentAccountController,
    PlatformSubscriptionsController,
  ],
  providers: [
    MercadoPagoWebhooksService,
    PlatformSubscriptionsService,
    ReconciliationService,
    SellerAccountsService,
    {
      provide: OAUTH_CLIENT,
      inject: [configuration.KEY],
      useFactory: ({ mercadoPago: mp }: AppConfiguration) =>
        mp.clientId && mp.clientSecret && mp.oauthRedirectUri
          ? new MercadoPagoOAuth({
              environment: mp.environment,
              clientId: mp.clientId,
              clientSecret: mp.clientSecret,
              oauthRedirectUri: mp.oauthRedirectUri,
            })
          : null,
    },
    {
      provide: PAYMENT_PROVIDER,
      inject: [configuration.KEY, SellerAccountsService],
      useFactory: (env: AppConfiguration, accounts: SellerAccountsService) =>
        createPaymentProvider(env.mercadoPago, (tenantId) =>
          accounts.accessToken(tenantId),
        ),
    },
  ],
  exports: [PAYMENT_PROVIDER, SellerAccountsService],
})
export class PaymentsModule {}

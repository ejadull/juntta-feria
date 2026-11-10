import { Module } from '@nestjs/common';
import {
  configuration,
  type AppConfiguration,
} from '../config/configuration.js';
import { MercadoPagoWebhooksController } from './mercadopago-webhooks.controller.js';
import { MercadoPagoWebhooksService } from './mercadopago-webhooks.service.js';
import { MercadoPagoOAuth, OAUTH_CLIENT } from './mercadopago-oauth.js';
import { MercadoPagoProvider } from './mercadopago.provider.js';
import { PaymentAccountController } from './payment-account.controller.js';
import { PaymentIncidentsController } from './payment-incidents.controller.js';
import { PAYMENT_PROVIDER } from './payment-provider.js';
import { ReconciliationService } from './reconciliation.service.js';
import { SellerAccountsService } from './seller-accounts.service.js';

/**
 * PAY-01: the PaymentProvider port bound to Mercado Pago (ADR 0006); PAY-03: its webhooks;
 * PAY-07: each organizer's seller account, linked by OAuth.
 */
@Module({
  controllers: [
    MercadoPagoWebhooksController,
    PaymentIncidentsController,
    PaymentAccountController,
  ],
  providers: [
    MercadoPagoWebhooksService,
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
        new MercadoPagoProvider(env.mercadoPago, (tenantId) =>
          accounts.accessToken(tenantId),
        ),
    },
  ],
  exports: [PAYMENT_PROVIDER, SellerAccountsService],
})
export class PaymentsModule {}

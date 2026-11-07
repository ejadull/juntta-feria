import { Module } from '@nestjs/common';
import { configuration, type AppConfiguration } from '../config/configuration.js';
import { MercadoPagoWebhooksController } from './mercadopago-webhooks.controller.js';
import { MercadoPagoWebhooksService } from './mercadopago-webhooks.service.js';
import { MercadoPagoProvider } from './mercadopago.provider.js';
import { PAYMENT_PROVIDER } from './payment-provider.js';

/** PAY-01: the PaymentProvider port bound to Mercado Pago (ADR 0006); PAY-03: its webhooks. */
@Module({
  controllers: [MercadoPagoWebhooksController],
  providers: [
    MercadoPagoWebhooksService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [configuration.KEY],
      useFactory: (env: AppConfiguration) => new MercadoPagoProvider(env.mercadoPago),
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}

import { Module } from '@nestjs/common';
import { configuration, type AppConfiguration } from '../config/configuration.js';
import { MercadoPagoProvider } from './mercadopago.provider.js';
import { PAYMENT_PROVIDER } from './payment-provider.js';

/** PAY-01: the PaymentProvider port bound to Mercado Pago (ADR 0006). */
@Module({
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [configuration.KEY],
      useFactory: (env: AppConfiguration) => new MercadoPagoProvider(env.mercadoPago),
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}

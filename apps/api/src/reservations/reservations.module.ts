import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { CheckoutService } from './checkout.service.js';
import { ReservationsController } from './reservations.controller.js';
import { ReservationsService } from './reservations.service.js';

/** RES-01: concurrent reservations with holds (§2.1 ReservationsModule); PAY-02: checkout. */
@Module({
  imports: [PaymentsModule],
  controllers: [ReservationsController],
  providers: [ReservationsService, CheckoutService],
})
export class ReservationsModule {}

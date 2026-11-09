import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { CheckoutService } from './checkout.service.js';
import { RefundsService } from './refunds.service.js';
import { ReservationsController } from './reservations.controller.js';
import { ReservationsService } from './reservations.service.js';

/** RES-01: concurrent reservations with holds (§2.1 ReservationsModule); PAY-02: checkout; PAY-06: refunds. */
@Module({
  imports: [PaymentsModule],
  controllers: [ReservationsController],
  providers: [ReservationsService, CheckoutService, RefundsService],
})
export class ReservationsModule {}

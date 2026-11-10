import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import type { CheckoutDto } from '../../../shared/mercado-pago-wallet';
import {
  ReservationPaymentRepository,
  type ReservationDto,
} from './reservation-payment.repository';

/** RES-01 / PAY-02 through the API. Each user action gets its own Idempotency-Key. */
@Injectable()
export class HttpReservationPaymentRepository extends ReservationPaymentRepository {
  private readonly http = inject(HttpClient);

  reservation(id: string): Observable<ReservationDto> {
    return this.http.get<ReservationDto>(`${API_BASE}/reservations/${encodeURIComponent(id)}`);
  }

  checkout(id: string): Observable<CheckoutDto> {
    return this.http.post<CheckoutDto>(
      `${API_BASE}/reservations/${encodeURIComponent(id)}/checkout`,
      {},
      { headers: { 'Idempotency-Key': crypto.randomUUID() } },
    );
  }
}

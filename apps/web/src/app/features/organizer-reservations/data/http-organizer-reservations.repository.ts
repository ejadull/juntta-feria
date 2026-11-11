import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import {
  OrganizerReservationsRepository,
  type OrganizerEventDto,
  type OrganizerReservationDto,
  type PaymentIncidentDto,
  type RefundResultDto,
} from './organizer-reservations.repository';

/** RES-01 / PAY-05 / PAY-06 through the API (tenant and token come from the interceptor). */
@Injectable()
export class HttpOrganizerReservationsRepository extends OrganizerReservationsRepository {
  private readonly http = inject(HttpClient);

  events(): Observable<readonly OrganizerEventDto[]> {
    return this.http.get<readonly OrganizerEventDto[]>(`${API_BASE}/events`);
  }

  reservations(eventId: string): Observable<readonly OrganizerReservationDto[]> {
    return this.http.get<readonly OrganizerReservationDto[]>(`${API_BASE}/reservations`, {
      params: { eventId },
    });
  }

  cancel(reservationId: string): Observable<void> {
    return this.http
      .post(`${API_BASE}/reservations/${encodeURIComponent(reservationId)}/cancel`, {})
      .pipe(map(() => undefined));
  }

  refund(
    reservationId: string,
    idempotencyKey: string,
    amountCents?: number,
  ): Observable<RefundResultDto> {
    return this.http.post<RefundResultDto>(
      `${API_BASE}/reservations/${encodeURIComponent(reservationId)}/refunds`,
      amountCents === undefined ? {} : { amountCents },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
  }

  incidents(): Observable<readonly PaymentIncidentDto[]> {
    return this.http.get<readonly PaymentIncidentDto[]>(`${API_BASE}/payment-incidents`);
  }
}

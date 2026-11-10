import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import type { ReservationDto } from '../../checkout-return/data/reservation-payment.repository';

/** RES-01: holds and lists of the signed-in exhibitor (the tenant header comes from the interceptor). */
@Injectable({ providedIn: 'root' })
export class ReservationsApi {
  private readonly http = inject(HttpClient);

  /** `idempotencyKey` is per user action: repeating it returns the same hold. */
  hold(
    eventStandId: string,
    termsVersion: string,
    idempotencyKey: string,
  ): Observable<ReservationDto> {
    return this.http.post<ReservationDto>(
      `${API_BASE}/reservations`,
      { eventStandId, termsVersion },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
  }

  list(): Observable<readonly ReservationDto[]> {
    return this.http.get<readonly ReservationDto[]>(`${API_BASE}/reservations`);
  }

  cancel(id: string): Observable<ReservationDto> {
    return this.http.post<ReservationDto>(
      `${API_BASE}/reservations/${encodeURIComponent(id)}/cancel`,
      {},
    );
  }
}

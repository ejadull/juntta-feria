import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE } from '../../shared/api/api-base';

export type SubscriptionStatus = 'NONE' | 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

/** `/me/subscription` (EXH-05). `initPoint` only while PENDING; the price is not exposed. */
export interface SubscriptionDto {
  readonly status: SubscriptionStatus;
  readonly currentPeriodEnd?: string | null;
  readonly initPoint?: string;
}

const URL = `${API_BASE}/me/subscription`;

/** The exhibitor's platform subscription. Global per user: no organization header. */
@Injectable({ providedIn: 'root' })
export class SubscriptionApi {
  private readonly http = inject(HttpClient);

  get(): Observable<SubscriptionDto> {
    return this.http.get<SubscriptionDto>(URL);
  }

  start(payerEmail: string, idempotencyKey: string): Observable<SubscriptionDto> {
    return this.http.post<SubscriptionDto>(
      URL,
      { payerEmail },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
  }

  cancel(): Observable<SubscriptionDto> {
    return this.http.delete<SubscriptionDto>(URL);
  }
}

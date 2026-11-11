import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, throwError, type Observable } from 'rxjs';
import { API_BASE } from '../../../shared/api/api-base';
import { problemOf } from '../../../shared/auth/problem';
import { PaymentAccountRepository, type SellerAccountDto } from './payment-account.repository';

const ACCOUNT = `${API_BASE}/payment-account`;

/** PAY-07 through the API. Link failures surface the problem `code` (INVALID_OAUTH_STATE) as the message. */
@Injectable()
export class HttpPaymentAccountRepository extends PaymentAccountRepository {
  private readonly http = inject(HttpClient);

  status(): Observable<SellerAccountDto> {
    return this.http.get<SellerAccountDto>(ACCOUNT);
  }

  startLink(): Observable<string> {
    return this.http
      .post<{ authorizationUrl: string }>(`${ACCOUNT}/authorization`, {})
      .pipe(map((body) => body.authorizationUrl));
  }

  completeLink(code: string, state: string): Observable<SellerAccountDto> {
    return this.http
      .post<SellerAccountDto>(`${ACCOUNT}/link`, { code, state })
      .pipe(
        catchError((error: unknown) =>
          throwError(() => new Error(problemOf(error).code ?? 'LINK_FAILED')),
        ),
      );
  }

  unlink(): Observable<void> {
    return this.http.delete<void>(ACCOUNT);
  }
}

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HttpReservationPaymentRepository } from './http-reservation-payment.repository';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), HttpReservationPaymentRepository],
  });
  return {
    repo: TestBed.inject(HttpReservationPaymentRepository),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpReservationPaymentRepository (RES-01, PAY-02)', () => {
  it('reads the reservation from the API', () => {
    const { repo, http } = setup();
    let status = '';
    repo.reservation('r 1').subscribe((r) => (status = r.status));
    const req = http.expectOne('/api/v1/reservations/r%201');
    expect(req.request.method).toBe('GET');
    req.flush({ id: 'r 1', status: 'CONFIRMED' });
    expect(status).toBe('CONFIRMED');
  });

  it('opens the checkout with a fresh Idempotency-Key per user action', () => {
    const { repo, http } = setup();
    const keys: (string | null)[] = [];
    for (let i = 0; i < 2; i++) {
      repo.checkout('r1').subscribe();
      const req = http.expectOne('/api/v1/reservations/r1/checkout');
      expect(req.request.method).toBe('POST');
      keys.push(req.request.headers.get('Idempotency-Key'));
      req.flush({ checkoutUrl: 'https://mp', preferenceId: 'p', wallet: null });
    }
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).not.toBe(keys[0]);
  });
});

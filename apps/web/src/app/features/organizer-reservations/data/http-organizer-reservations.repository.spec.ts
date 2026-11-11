import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HttpOrganizerReservationsRepository } from './http-organizer-reservations.repository';

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      HttpOrganizerReservationsRepository,
    ],
  });
  return {
    repo: TestBed.inject(HttpOrganizerReservationsRepository),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpOrganizerReservationsRepository (RES-01, PAY-05, PAY-06)', () => {
  it('reads the events and the reservations of one event', () => {
    const { repo, http } = setup();
    repo.events().subscribe();
    expect(http.expectOne('/api/v1/events').request.method).toBe('GET');

    repo.reservations('e 1').subscribe();
    const req = http.expectOne((r) => r.url === '/api/v1/reservations');
    expect(req.request.params.get('eventId')).toBe('e 1');
  });

  it('cancels a hold', () => {
    const { repo, http } = setup();
    let done = false;
    repo.cancel('r 1').subscribe(() => (done = true));
    const req = http.expectOne('/api/v1/reservations/r%201/cancel');
    expect(req.request.method).toBe('POST');
    req.flush({ id: 'r 1', status: 'CANCELLED' });
    expect(done).toBe(true);
  });

  it('refunds with the Idempotency-Key of the action, and the amount only when partial', () => {
    const { repo, http } = setup();
    repo.refund('r1', 'key-1').subscribe();
    const full = http.expectOne('/api/v1/reservations/r1/refunds');
    expect(full.request.headers.get('Idempotency-Key')).toBe('key-1');
    expect(full.request.body).toEqual({});
    full.flush({ reservationStatus: 'REFUNDED', refunds: [] });

    repo.refund('r1', 'key-2', 500_000).subscribe();
    const partial = http.expectOne('/api/v1/reservations/r1/refunds');
    expect(partial.request.headers.get('Idempotency-Key')).toBe('key-2');
    expect(partial.request.body).toEqual({ amountCents: 500_000 });
  });

  it('reads the payment incidents', () => {
    const { repo, http } = setup();
    repo.incidents().subscribe();
    expect(http.expectOne('/api/v1/payment-incidents').request.method).toBe('GET');
  });
});

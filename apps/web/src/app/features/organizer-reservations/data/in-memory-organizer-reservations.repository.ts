import { defer, of, throwError, type Observable } from 'rxjs';
import {
  OrganizerReservationsRepository,
  type OrganizerEventDto,
  type OrganizerReservationDto,
  type PaymentIncidentDto,
  type RefundResultDto,
} from './organizer-reservations.repository';

const MINUTE = 60_000;
const EVENT_ID = 'demo-event';

const demo = (
  id: string,
  code: string,
  status: OrganizerReservationDto['status'],
  patch: Partial<OrganizerReservationDto> = {},
): OrganizerReservationDto => ({
  id,
  status,
  holdExpiresAt: status === 'HELD' ? new Date(Date.now() + 10 * MINUTE).toISOString() : null,
  amount: { currency: 'ARS', valueCents: 1_740_000 },
  stand: { id: `stand-${code}`, code, areaM2: 9 },
  eventId: EVENT_ID,
  createdAt: new Date(Date.now() - 60 * MINUTE).toISOString(),
  exhibitor: { tradeName: `Feriante ${code}`, email: `${code.toLowerCase()}@example.test` },
  payment: null,
  ...patch,
});

/** Test and demo adapter: a small mutable event with one reservation per state. */
export class InMemoryOrganizerReservationsRepository extends OrganizerReservationsRepository {
  private items: readonly OrganizerReservationDto[] = [
    demo('r1', 'S1', 'HELD'),
    demo('r2', 'S2', 'PAYMENT_PENDING', {
      payment: { status: 'PENDING', paymentStatus: 'pending', updatedAt: new Date().toISOString() },
    }),
    demo('r3', 'S3', 'CONFIRMED', {
      payment: {
        status: 'APPROVED',
        paymentStatus: 'approved',
        updatedAt: new Date().toISOString(),
      },
    }),
    demo('r4', 'S4', 'EXPIRED'),
  ];

  events(): Observable<readonly OrganizerEventDto[]> {
    return of([
      {
        id: EVENT_ID,
        name: 'Feria de demostración',
        status: 'PUBLISHED',
        startsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      },
    ]);
  }

  reservations(eventId: string): Observable<readonly OrganizerReservationDto[]> {
    return defer(() => of(this.items.filter((r) => r.eventId === eventId)));
  }

  cancel(reservationId: string): Observable<void> {
    return this.move(reservationId, 'CANCELLED');
  }

  refund(reservationId: string): Observable<RefundResultDto> {
    const current = this.items.find((r) => r.id === reservationId);
    const next: OrganizerReservationDto['status'] =
      current?.status === 'PAYMENT_PENDING' ? 'CANCELLED' : 'REFUNDED';
    return defer(() => {
      this.move(reservationId, next).subscribe();
      return of({ reservationStatus: next });
    });
  }

  incidents(): Observable<readonly PaymentIncidentDto[]> {
    return of([
      {
        id: 'i1',
        code: 'LATE_PAYMENT_CONFLICT',
        reservationId: 'r4',
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  private move(id: string, status: OrganizerReservationDto['status']): Observable<void> {
    return defer(() => {
      if (!this.items.some((r) => r.id === id)) return throwError(() => new Error('NOT_FOUND'));
      this.items = this.items.map((r) => (r.id === id ? { ...r, status, holdExpiresAt: null } : r));
      return of(undefined);
    });
  }
}

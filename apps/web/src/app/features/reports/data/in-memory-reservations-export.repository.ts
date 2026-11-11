import { of, type Observable } from 'rxjs';
import { ReservationsExportRepository, type ExportFile } from './reservations-export.repository';

/** Test double: a one-row CSV. */
export class InMemoryReservationsExportRepository extends ReservationsExportRepository {
  download(eventId: string): Observable<ExportFile> {
    return of({
      filename: `reservas-${eventId}.csv`,
      blob: new Blob(['Stand,Expositor\r\nS1,Ana\r\n'], { type: 'text/csv' }),
    });
  }
}

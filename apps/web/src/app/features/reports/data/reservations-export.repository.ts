import type { Observable } from 'rxjs';

/** The CSV of an event's reservations, named by the API (event slug and date). */
export interface ExportFile {
  readonly filename: string;
  readonly blob: Blob;
}

/** Port for REP-01's CSV export. Also the DI token. */
export abstract class ReservationsExportRepository {
  abstract download(eventId: string): Observable<ExportFile>;
}

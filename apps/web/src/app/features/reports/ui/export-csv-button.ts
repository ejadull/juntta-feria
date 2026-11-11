import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { BROWSER_DOWNLOAD } from '../../../shared/browser-download';
import { ReservationsExportRepository } from '../data/reservations-export.repository';

/** REP-01: "Exportar CSV" of the reservations of one event, with spoken feedback. */
@Component({
  selector: 'app-export-csv-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="btn" [disabled]="!eventId() || busy()" (click)="export()">
      Exportar CSV
    </button>
    <p aria-live="polite" class="sr-only">{{ notice() }}</p>
    @if (error(); as message) {
      <p role="alert" class="mt-2 text-sm text-text">{{ message }}</p>
    }
  `,
})
export class ExportCsvButton {
  readonly eventId = input.required<string | null>();

  private readonly repository = inject(ReservationsExportRepository);
  private readonly save = inject(BROWSER_DOWNLOAD);

  protected readonly busy = signal(false);
  protected readonly notice = signal('');
  protected readonly error = signal<string | null>(null);

  protected export(): void {
    const id = this.eventId();
    if (!id) return;
    this.busy.set(true);
    this.notice.set('');
    this.error.set(null);
    this.repository.download(id).subscribe({
      next: (file) => {
        this.save(file.blob, file.filename);
        this.busy.set(false);
        this.notice.set(`Descargamos ${file.filename}.`);
      },
      error: () => {
        this.busy.set(false);
        this.error.set('No pudimos exportar las reservas. Probá de nuevo en unos minutos.');
      },
    });
  }
}

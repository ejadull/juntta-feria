import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { throwError } from 'rxjs';
import { BROWSER_DOWNLOAD } from '../../../shared/browser-download';
import { InMemoryReservationsExportRepository } from '../data/in-memory-reservations-export.repository';
import { ReservationsExportRepository } from '../data/reservations-export.repository';
import { ExportCsvButton } from './export-csv-button';

@Component({
  imports: [ExportCsvButton],
  template: `<app-export-csv-button [eventId]="eventId" />`,
})
class Host {
  eventId: string | null = 'e1';
}

async function render(
  repo: ReservationsExportRepository = new InMemoryReservationsExportRepository(),
  eventId: string | null = 'e1',
) {
  const save = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: ReservationsExportRepository, useValue: repo },
      { provide: BROWSER_DOWNLOAD, useValue: save },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.eventId = eventId;
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const button = () => host.querySelector('button') as HTMLButtonElement;
  return { fixture, host, button, save };
}

describe('ExportCsvButton (REP-01)', () => {
  it('downloads the CSV of the event with the name the API gave it', async () => {
    const { button, save, fixture, host } = await render();
    button().click();
    await fixture.whenStable();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toBe('reservas-e1.csv');
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain('Descargamos');
  });

  it('is disabled while there is no event', async () => {
    const { button } = await render(undefined, null);
    expect(button().disabled).toBe(true);
  });

  it('says so when the export fails and saves nothing', async () => {
    const repo = new InMemoryReservationsExportRepository();
    repo.download = () => throwError(() => ({ status: 500 }));
    const { button, save, fixture, host } = await render(repo);
    button().click();
    await fixture.whenStable();
    expect(save).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No pudimos exportar');
  });
});

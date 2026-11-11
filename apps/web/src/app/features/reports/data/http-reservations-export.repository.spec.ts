import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { HttpReservationsExportRepository } from './http-reservations-export.repository';

const URL_OF = '/api/v1/events/e1/reservations/export';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), HttpReservationsExportRepository],
  });
  return {
    repo: TestBed.inject(HttpReservationsExportRepository),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpReservationsExportRepository', () => {
  it('requests the CSV as a blob and uses the filename the API sends', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.download('e1'));
    const request = http.expectOne(URL_OF);
    expect(request.request.method).toBe('GET');
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['a']), {
      headers: { 'Content-Disposition': 'attachment; filename="reservas-feria-2026-11-11.csv"' },
    });
    const file = await result;
    expect(file.filename).toBe('reservas-feria-2026-11-11.csv');
    expect(file.blob.size).toBe(1);
    http.verify();
  });

  it('falls back to a name built from the event when the header is not readable', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.download('e1'));
    http.expectOne(URL_OF).flush(new Blob(['a']));
    expect((await result).filename).toBe('reservas-e1.csv');
  });

  it('fails with the HTTP error', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.download('e1'));
    http.expectOne(URL_OF).flush(new Blob([]), { status: 403, statusText: 'Forbidden' });
    await expect(result).rejects.toMatchObject({ status: 403 });
  });
});

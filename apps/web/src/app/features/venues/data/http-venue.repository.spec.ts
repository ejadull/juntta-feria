import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { HttpVenueRepository } from './http-venue.repository';
import type { VenueInput } from './venue.repository';

const INPUT: VenueInput = {
  type: 'FIXED',
  name: 'Espacio Duam',
  address: null,
  timezone: 'America/Argentina/Buenos_Aires',
  widthM: 40,
  heightM: 25.5,
};

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), HttpVenueRepository],
  });
  return {
    repo: TestBed.inject(HttpVenueRepository),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpVenueRepository', () => {
  it('lists GET /api/v1/venues', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.list());
    const request = http.expectOne('/api/v1/venues');
    expect(request.request.method).toBe('GET');
    request.flush([{ id: 'v1', ...INPUT }]);
    expect((await result)[0].name).toBe('Espacio Duam');
    http.verify();
  });

  it('creates with POST and the whole input as body', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.create(INPUT));
    const request = http.expectOne('/api/v1/venues');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(INPUT);
    request.flush({ id: 'v1', ...INPUT }, { status: 201, statusText: 'Created' });
    expect((await result).id).toBe('v1');
    http.verify();
  });

  it('updates with PATCH /:id', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.update('v 1', INPUT));
    const request = http.expectOne('/api/v1/venues/v%201');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual(INPUT);
    request.flush({ id: 'v 1', ...INPUT });
    await result;
    http.verify();
  });

  it('removes with DELETE /:id', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.remove('v1'), { defaultValue: undefined });
    const request = http.expectOne('/api/v1/venues/v1');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await result;
    http.verify();
  });

  it('fails with the HTTP error so the page can say what happened', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.remove('v1'));
    http
      .expectOne('/api/v1/venues/v1')
      .flush({ code: 'x' }, { status: 409, statusText: 'Conflict' });
    await expect(result).rejects.toMatchObject({ status: 409 });
  });
});

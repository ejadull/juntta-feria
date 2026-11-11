import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { HttpEventInventoryRepository } from './http-event-inventory.repository';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), HttpEventInventoryRepository],
  });
  return {
    repo: TestBed.inject(HttpEventInventoryRepository),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpEventInventoryRepository', () => {
  it('lists sectors with GET /events/:id/sectors', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.listSectors('e 1'));
    const request = http.expectOne('/api/v1/events/e%201/sectors');
    expect(request.request.method).toBe('GET');
    request.flush([{ id: 's1', name: 'Gastronomía', sortOrder: 0 }]);
    expect((await result)[0].name).toBe('Gastronomía');
    http.verify();
  });

  it('creates a sector with POST', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.createSector('e1', { name: 'Diseño', sortOrder: 2 }));
    const request = http.expectOne('/api/v1/events/e1/sectors');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Diseño', sortOrder: 2 });
    request.flush(
      { id: 's2', name: 'Diseño', sortOrder: 2 },
      { status: 201, statusText: 'Created' },
    );
    expect((await result).id).toBe('s2');
    http.verify();
  });

  it('updates a sector with PATCH /sectors/:sectorId', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.updateSector('e1', 's2', { name: 'Moda' }));
    const request = http.expectOne('/api/v1/events/e1/sectors/s2');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ name: 'Moda' });
    request.flush({ id: 's2', name: 'Moda', sortOrder: 2 });
    await result;
    http.verify();
  });

  it('removes a sector with DELETE', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.removeSector('e1', 's2'), { defaultValue: undefined });
    const request = http.expectOne('/api/v1/events/e1/sectors/s2');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await result;
    http.verify();
  });

  it('lists the stands of the event', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.listStands('e1'));
    const request = http.expectOne('/api/v1/events/e1/stands');
    expect(request.request.method).toBe('GET');
    request.flush([{ id: 'st1', code: 'S1', priceCents: 0, hasPrice: false }]);
    expect((await result)[0].hasPrice).toBe(false);
    http.verify();
  });

  it('updates stands in bulk with PATCH and the change as body', async () => {
    const { repo, http } = setup();
    const change = { standIds: ['st1', 'st2'], priceCents: 150_000, sectorId: null };
    const result = firstValueFrom(repo.updateStands('e1', change));
    const request = http.expectOne('/api/v1/events/e1/stands');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual(change);
    request.flush([{ id: 'st1' }, { id: 'st2' }]);
    expect(await result).toHaveLength(2);
    http.verify();
  });

  it('fails with the HTTP error so the panel can say what happened', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(
      repo.updateStands('e1', { standIds: ['st1'], status: 'BLOCKED' }),
    );
    http.expectOne('/api/v1/events/e1/stands').flush({}, { status: 409, statusText: 'Conflict' });
    await expect(result).rejects.toMatchObject({ status: 409 });
  });
});

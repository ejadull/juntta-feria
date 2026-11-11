import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { HttpExhibitorRepository } from './http-exhibitor.repository';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), HttpExhibitorRepository],
  });
  return {
    repo: TestBed.inject(HttpExhibitorRepository),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpExhibitorRepository', () => {
  it('reads GET /api/v1/exhibitors', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.list());
    const request = http.expectOne('/api/v1/exhibitors');
    expect(request.request.method).toBe('GET');
    request.flush([{ id: 'x1', tradeName: 'Lanas', documentsStatus: 'MISSING' }]);
    expect((await result)[0].tradeName).toBe('Lanas');
    http.verify();
  });

  it('fails with the HTTP error so the page can say it could not load', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.list());
    http.expectOne('/api/v1/exhibitors').flush({}, { status: 403, statusText: 'Forbidden' });
    await expect(result).rejects.toMatchObject({ status: 403 });
  });
});

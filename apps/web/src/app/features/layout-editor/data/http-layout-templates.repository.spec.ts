import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { HttpLayoutTemplatesRepository } from './http-layout-templates.repository';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), HttpLayoutTemplatesRepository],
  });
  return {
    repo: TestBed.inject(HttpLayoutTemplatesRepository),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpLayoutTemplatesRepository', () => {
  it('lists GET /api/v1/layout-templates with the status of each version', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.list());
    const request = http.expectOne('/api/v1/layout-templates');
    expect(request.request.method).toBe('GET');
    request.flush([
      {
        id: 't1',
        name: 'Salón',
        venueId: 'v1',
        versions: [{ id: 'lv1', version: 1, status: 'DRAFT', publishedAt: null }],
      },
    ]);
    expect((await result)[0].versions[0].status).toBe('DRAFT');
    http.verify();
  });

  it('creates with POST and returns the first draft', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.create({ name: 'Salón', venueId: 'v1' }));
    const request = http.expectOne('/api/v1/layout-templates');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'Salón', venueId: 'v1' });
    request.flush(
      { id: 'lv1', status: 'DRAFT', objects: [] },
      { status: 201, statusText: 'Created' },
    );
    expect((await result).id).toBe('lv1');
    http.verify();
  });

  it('fails with the HTTP error when the name is taken', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.create({ name: 'Salón', venueId: 'v1' }));
    http.expectOne('/api/v1/layout-templates').flush({}, { status: 409, statusText: 'Conflict' });
    await expect(result).rejects.toMatchObject({ status: 409 });
  });
});

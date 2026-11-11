import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { EventPublishRejectedError } from './event-admin.repository';
import { HttpEventAdminRepository } from './http-event-admin.repository';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), HttpEventAdminRepository],
  });
  return {
    repo: TestBed.inject(HttpEventAdminRepository),
    http: TestBed.inject(HttpTestingController),
  };
}

const INPUT = {
  venueId: 'v1',
  layoutVersionId: 'lv1',
  name: 'Feria de Primavera',
  startsAt: '2026-11-20T10:00:00-03:00',
  endsAt: '2026-11-22T20:00:00-03:00',
  salesOpenAt: '2026-10-01T00:00:00-03:00',
  salesCloseAt: '2026-11-19T00:00:00-03:00',
};

describe('HttpEventAdminRepository', () => {
  it('lists GET /api/v1/events', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.list());
    const request = http.expectOne('/api/v1/events');
    expect(request.request.method).toBe('GET');
    request.flush([{ id: 'e1', status: 'DRAFT' }]);
    expect((await result)[0].status).toBe('DRAFT');
    http.verify();
  });

  it('reads one event with GET /events/:id', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.get('e 1'));
    const request = http.expectOne('/api/v1/events/e%201');
    expect(request.request.method).toBe('GET');
    request.flush({ id: 'e 1' });
    await result;
    http.verify();
  });

  it('creates with POST and the whole input as body', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.create({ ...INPUT, slug: 'primavera' }));
    const request = http.expectOne('/api/v1/events');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ ...INPUT, slug: 'primavera' });
    request.flush({ id: 'e1' }, { status: 201, statusText: 'Created' });
    expect((await result).id).toBe('e1');
    http.verify();
  });

  it('updates with PATCH /events/:id and only the changed fields', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.update('e1', { name: 'Otro nombre' }));
    const request = http.expectOne('/api/v1/events/e1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ name: 'Otro nombre' });
    request.flush({ id: 'e1' });
    await result;
    http.verify();
  });

  it('publishes with POST /events/:id/publish', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.publish('e1'));
    const request = http.expectOne('/api/v1/events/e1/publish');
    expect(request.request.method).toBe('POST');
    request.flush({ id: 'e1', status: 'PUBLISHED' });
    expect((await result).status).toBe('PUBLISHED');
    http.verify();
  });

  it('turns the 422 issues of a rejected publish into EventPublishRejectedError', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.publish('e1'));
    http.expectOne('/api/v1/events/e1/publish').flush(
      {
        status: 422,
        issues: [{ code: 'STAND_WITHOUT_PRICE', objectIds: ['s1', 's2'], message: 'x' }],
      },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    const error = (await result.catch((e: unknown) => e)) as EventPublishRejectedError;
    expect(error).toBeInstanceOf(EventPublishRejectedError);
    expect(error.issues[0]).toMatchObject({ code: 'STAND_WITHOUT_PRICE', objectIds: ['s1', 's2'] });
  });

  it('keeps any other publish failure as the HTTP error', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.publish('e1'));
    http.expectOne('/api/v1/events/e1/publish').flush({}, { status: 409, statusText: 'Conflict' });
    await expect(result).rejects.toMatchObject({ status: 409 });
  });
});

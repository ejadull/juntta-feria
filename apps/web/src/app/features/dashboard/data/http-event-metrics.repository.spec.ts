import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { EventNotFoundError } from './event-metrics.repository';
import { HttpEventMetricsRepository } from './http-event-metrics.repository';

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), HttpEventMetricsRepository],
  });
  return {
    repo: TestBed.inject(HttpEventMetricsRepository),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('HttpEventMetricsRepository (REP-01)', () => {
  it('reads GET /api/v1/events/:id/metrics?days=30 and returns the body as is', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.get('e1'));
    const request = http.expectOne('/api/v1/events/e1/metrics?days=30');
    expect(request.request.method).toBe('GET');
    request.flush({ eventId: 'e1', eventName: 'Feria', sellableStands: 3, gmvByMonth: [] });
    expect(await result).toMatchObject({ eventId: 'e1', sellableStands: 3 });
    http.verify();
  });

  it('turns a 404 into EventNotFoundError', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.get('nope'));
    http
      .expectOne('/api/v1/events/nope/metrics?days=30')
      .flush({ status: 404 }, { status: 404, statusText: 'Not Found' });
    await expect(result).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it('keeps other failures as HTTP errors', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.get('e1'));
    http
      .expectOne('/api/v1/events/e1/metrics?days=30')
      .flush({}, { status: 500, statusText: 'Server Error' });
    await expect(result).rejects.toMatchObject({ status: 500 });
  });
});

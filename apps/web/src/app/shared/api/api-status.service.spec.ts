import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './api-base';
import { ApiStatusService } from './api-status.service';

const setup = () => ({
  service: TestBed.inject(ApiStatusService),
  http: TestBed.inject(HttpTestingController),
});

describe('ApiStatusService (FND-05)', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }),
  );
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('uses the relative, versioned base so the dev proxy can route it', () => {
    expect(API_BASE).toBe('/api/v1');
  });

  it('reports "up" when liveness answers ok', async () => {
    const { service, http } = setup();
    const result = firstValueFrom(service.check());
    const req = http.expectOne('/api/v1/health/live');
    expect(req.request.method).toBe('GET');
    req.flush({ status: 'ok' });
    expect(await result).toBe('up');
  });

  it('reports "down" on an HTTP error', async () => {
    const { service, http } = setup();
    const result = firstValueFrom(service.check());
    http
      .expectOne('/api/v1/health/live')
      .flush({ status: 502 }, { status: 502, statusText: 'Bad Gateway' });
    expect(await result).toBe('down');
  });

  it('reports "down" when the API is unreachable', async () => {
    const { service, http } = setup();
    const result = firstValueFrom(service.check());
    http.expectOne('/api/v1/health/live').error(new ProgressEvent('error'));
    expect(await result).toBe('down');
  });

  it('reports "down" when the body is not the liveness payload', async () => {
    const { service, http } = setup();
    const result = firstValueFrom(service.check());
    http.expectOne('/api/v1/health/live').flush('<html>dev server fallback</html>');
    expect(await result).toBe('down');
  });
});

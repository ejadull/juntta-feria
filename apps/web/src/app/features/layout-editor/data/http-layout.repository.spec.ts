import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import type { LayoutVersionDto } from '../domain/layout.types';
import { HttpLayoutRepository } from './http-layout.repository';
import {
  LayoutNotEditableError,
  LayoutNotFoundError,
  PublishRejectedError,
} from './layout.repository';

const VERSION: LayoutVersionDto = {
  id: 'v1',
  templateId: 't1',
  version: 1,
  status: 'DRAFT',
  widthM: 20,
  heightM: 10,
  objects: [
    {
      id: 'o1',
      kind: 'STAND',
      code: 'S1',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [3, 0],
            [3, 3],
            [0, 3],
            [0, 0],
          ],
        ],
      },
      metadata: {},
    },
  ],
};

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), HttpLayoutRepository],
  });
  return {
    repo: TestBed.inject(HttpLayoutRepository),
    http: TestBed.inject(HttpTestingController),
  };
}
const status = (code: number) => ({ status: code, statusText: String(code) });

describe('HttpLayoutRepository (LAY-01)', () => {
  it('reads GET /api/v1/layout-versions/:id', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.get('v1'));
    const request = http.expectOne('/api/v1/layout-versions/v1');
    expect(request.request.method).toBe('GET');
    request.flush(VERSION);
    expect(await result).toEqual(VERSION);
  });

  it('turns a 404 into LayoutNotFoundError', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.get('nope'));
    http.expectOne('/api/v1/layout-versions/nope').flush({}, status(404));
    await expect(result).rejects.toBeInstanceOf(LayoutNotFoundError);
  });

  it('saves a draft with PUT .../objects { objects } and returns the stored version', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.saveDraft(VERSION));
    const request = http.expectOne('/api/v1/layout-versions/v1/objects');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ objects: VERSION.objects });
    request.flush({ ...VERSION, publishedAt: null });
    expect((await result).id).toBe('v1');
  });

  it('turns a 409 on save into LayoutNotEditableError', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.saveDraft(VERSION));
    http.expectOne('/api/v1/layout-versions/v1/objects').flush({}, status(409));
    await expect(result).rejects.toBeInstanceOf(LayoutNotEditableError);
  });

  it('publishes with POST .../publish', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.publish('v1'));
    const request = http.expectOne('/api/v1/layout-versions/v1/publish');
    expect(request.request.method).toBe('POST');
    request.flush({ ...VERSION, status: 'PUBLISHED' });
    expect((await result).status).toBe('PUBLISHED');
  });

  it('maps the 422 problem issues into PublishRejectedError (severity added)', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.publish('v1'));
    http.expectOne('/api/v1/layout-versions/v1/publish').flush(
      {
        status: 422,
        issues: [{ code: 'STAND_OVERLAP', objectIds: ['o1', 'o2'], message: 'Se superponen.' }],
      },
      status(422),
    );
    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PublishRejectedError);
    expect((error as PublishRejectedError).issues).toEqual([
      {
        code: 'STAND_OVERLAP',
        severity: 'error',
        objectIds: ['o1', 'o2'],
        message: 'Se superponen.',
      },
    ]);
  });

  it('keeps an unrelated publish failure as the HTTP error', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.publish('v1'));
    http.expectOne('/api/v1/layout-versions/v1/publish').flush({}, status(403));
    await expect(result).rejects.toMatchObject({ status: 403 });
  });

  it('clones with POST /layout-templates/:templateId/versions { sourceVersionId }', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.cloneAsDraft(VERSION));
    const request = http.expectOne('/api/v1/layout-templates/t1/versions');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ sourceVersionId: 'v1' });
    request.flush({ ...VERSION, id: 'v2', version: 2 });
    expect((await result).version).toBe(2);
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, toArray } from 'rxjs';
import {
  HttpDocumentReviewRepository,
  HttpFileUploader,
  HttpOwnDocumentsRepository,
} from './http-documents.repository';

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      HttpOwnDocumentsRepository,
      HttpDocumentReviewRepository,
      HttpFileUploader,
    ],
  });
  return { http: TestBed.inject(HttpTestingController) };
}

describe('HttpOwnDocumentsRepository (EXH-03)', () => {
  it('lists, requests an upload, completes, downloads and removes under /exhibitors/me/documents', async () => {
    const { http } = setup();
    const repo = TestBed.inject(HttpOwnDocumentsRepository);

    const list = firstValueFrom(repo.list());
    http.expectOne({ method: 'GET', url: '/api/v1/exhibitors/me/documents' }).flush([]);
    expect(await list).toEqual([]);

    const request = {
      type: 'SEGURO',
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 9,
    } as const;
    const ticket = firstValueFrom(repo.requestUpload(request));
    const post = http.expectOne({ method: 'POST', url: '/api/v1/exhibitors/me/documents' });
    expect(post.request.body).toEqual(request);
    post.flush({ document: { id: 'd1' }, upload: { url: 'https://s.test/x' } });
    expect((await ticket).document.id).toBe('d1');

    const done = firstValueFrom(repo.complete('d1'));
    http
      .expectOne({ method: 'POST', url: '/api/v1/exhibitors/me/documents/d1/complete' })
      .flush({ id: 'd1' });
    await done;

    const dl = firstValueFrom(repo.download('d1'));
    http
      .expectOne('/api/v1/exhibitors/me/documents/d1/download')
      .flush({ url: 'u', fileName: 'a.pdf' });
    expect((await dl).fileName).toBe('a.pdf');

    const gone = firstValueFrom(repo.remove('d1'));
    http.expectOne({ method: 'DELETE', url: '/api/v1/exhibitors/me/documents/d1' }).flush(null);
    await gone;
    http.verify();
  });
});

describe('HttpDocumentReviewRepository (EXH-03)', () => {
  it('lists, downloads and reviews under /exhibitors/:id/documents', async () => {
    const { http } = setup();
    const repo = TestBed.inject(HttpDocumentReviewRepository);

    const list = firstValueFrom(repo.list('e1'));
    http.expectOne('/api/v1/exhibitors/e1/documents').flush([{ id: 'd1' }]);
    expect(await list).toHaveLength(1);

    const dl = firstValueFrom(repo.download('e1', 'd1'));
    http
      .expectOne('/api/v1/exhibitors/e1/documents/d1/download')
      .flush({ url: 'u', fileName: 'a' });
    await dl;

    const review = firstValueFrom(
      repo.review('e1', 'd1', { decision: 'REJECTED', reason: 'Vencida' }),
    );
    const post = http.expectOne({
      method: 'POST',
      url: '/api/v1/exhibitors/e1/documents/d1/review',
    });
    expect(post.request.body).toEqual({ decision: 'REJECTED', reason: 'Vencida' });
    post.flush({ id: 'd1', status: 'REJECTED' });
    expect((await review).status).toBe('REJECTED');
    http.verify();
  });
});

describe('HttpFileUploader', () => {
  it('PUTs the file to the signed URL with only the signed headers and reports progress', async () => {
    const { http } = setup();
    const uploader = TestBed.inject(HttpFileUploader);
    const file = new Blob(['%PDF'], { type: 'application/pdf' });

    const progress = firstValueFrom(
      uploader
        .put(
          { url: 'https://storage.test/b/k?sig=1', headers: { 'Content-Type': 'application/pdf' } },
          file,
        )
        .pipe(toArray()),
    );
    const put = http.expectOne({ method: 'PUT', url: 'https://storage.test/b/k?sig=1' });
    expect(put.request.headers.get('Content-Type')).toBe('application/pdf');
    expect(put.request.headers.has('Authorization')).toBe(false);
    expect(put.request.headers.has('X-Tenant-Id')).toBe(false);
    expect(put.request.body).toBe(file);
    put.event({ type: 1, loaded: 2, total: 4 } as never);
    put.flush('');
    expect(await progress).toEqual([50, 100]);
    http.verify();
  });
});

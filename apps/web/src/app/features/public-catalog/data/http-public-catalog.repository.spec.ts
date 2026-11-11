import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authInterceptor, TENANT_HEADER } from '../../../shared/auth/auth.interceptor';
import { signedInAs } from '../../../shared/auth/testing';
import { HttpPublicCatalogRepository } from './http-public-catalog.repository';
import { PublicEventNotFoundError, type PublicMapDto } from './public-catalog.repository';

const square: [number, number][][] = [
  [
    [0, 0],
    [3, 0],
    [3, 3],
    [0, 3],
    [0, 0],
  ],
];
const MAP = {
  slug: 'feria-1',
  layoutVersion: 2,
  units: 'm',
  bounds: { width: 20, height: 10 },
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: square },
      properties: { kind: 'AISLE', label: null },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: square },
      properties: { kind: 'ENTRY', label: 'Acceso norte' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: square },
      properties: {
        kind: 'STAND',
        standId: 'es1',
        code: 'S1',
        areaM2: 9,
        status: 'AVAILABLE',
        sector: null,
        price: { currency: 'ARS', valueCents: 100 },
        exhibitor: null,
      },
    },
  ],
};

function setup(signedIn = false) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      HttpPublicCatalogRepository,
      ...(signedIn ? [signedInAs('OWNER')] : []),
    ],
  });
  return {
    repo: TestBed.inject(HttpPublicCatalogRepository),
    http: TestBed.inject(HttpTestingController),
  };
}
const notFound = { status: 404, statusText: 'Not Found' };

describe('HttpPublicCatalogRepository (PUB-01)', () => {
  it('lists GET /api/v1/public/events anonymously: no tenant and no credentials', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.listEvents());
    const request = http.expectOne('/api/v1/public/events');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.has(TENANT_HEADER)).toBe(false);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush([{ slug: 'feria-1', name: 'Feria 1', organizerName: 'Org', venueAddress: null }]);
    expect((await result)[0].organizerName).toBe('Org');
  });

  it('never sends the organization header, even to a signed-in staff member', () => {
    const { repo, http } = setup(true);
    void firstValueFrom(repo.listEvents());
    const request = http.expectOne('/api/v1/public/events');
    expect(request.request.headers.has(TENANT_HEADER)).toBe(false);
    request.flush([]);
  });

  it('reads the map and names the areas without a label by their kind', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.getMap('feria-1'));
    http.expectOne('/api/v1/public/events/feria-1/map').flush(MAP);
    const map: PublicMapDto = await result;
    const labels = map.features.map((f) => f.properties.kind !== 'STAND' && f.properties.label);
    expect(labels).toEqual(['Pasillo', 'Acceso norte', false]);
    expect(map.features[2].properties).toMatchObject({ kind: 'STAND', code: 'S1' });
  });

  it('turns a 404 on the map into PublicEventNotFoundError', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.getMap('nope'));
    http.expectOne('/api/v1/public/events/nope/map').flush({}, notFound);
    await expect(result).rejects.toBeInstanceOf(PublicEventNotFoundError);
  });

  it('reads the directory and maps a 404 the same way', async () => {
    const { repo, http } = setup();
    const ok = firstValueFrom(repo.listExhibitors('feria-1'));
    const request = http.expectOne('/api/v1/public/events/feria-1/exhibitors');
    expect(request.request.method).toBe('GET');
    request.flush([{ name: 'Lanas', category: 'Textil', description: '', standCode: 'S1' }]);
    expect((await ok)[0].name).toBe('Lanas');

    const missing = firstValueFrom(repo.listExhibitors('nope'));
    http.expectOne('/api/v1/public/events/nope/exhibitors').flush({}, notFound);
    await expect(missing).rejects.toBeInstanceOf(PublicEventNotFoundError);
  });

  it('keeps other failures as HTTP errors', async () => {
    const { repo, http } = setup();
    const result = firstValueFrom(repo.listEvents());
    http.expectOne('/api/v1/public/events').flush({}, { status: 503, statusText: 'Unavailable' });
    await expect(result).rejects.toMatchObject({ status: 503 });
  });
});

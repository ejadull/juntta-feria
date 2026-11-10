import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { standsOf } from '../domain/stand-filters';
import { HttpTenantCatalogRepository } from './http-tenant-catalog.repository';
import { PublicEventNotFoundError, type PublicMapDto } from './public-catalog.repository';

const rect = (x: number, y: number): [number, number][][] => [
  [
    [x, y],
    [x + 3, y],
    [x + 3, y + 3],
    [x, y + 3],
    [x, y],
  ],
];
const polygon = (x: number, y: number) => ({ type: 'Polygon' as const, coordinates: rect(x, y) });

const EVENT = {
  id: 'e1',
  slug: 'feria-1',
  name: 'Feria 1',
  layoutVersionId: 'lv1',
  startsAt: '2026-11-20T13:00:00Z',
  endsAt: '2026-11-22T23:00:00Z',
  salesOpenAt: '2026-01-01T00:00:00Z',
  salesCloseAt: '2099-01-01T00:00:00Z',
};
const LAYOUT = {
  version: 3,
  widthM: 20,
  heightM: 10,
  objects: [
    { id: 'o1', kind: 'STAND', code: 'S1', geometry: polygon(0, 0), metadata: {} },
    { id: 'o2', kind: 'AISLE', code: null, geometry: polygon(5, 0), metadata: {} },
    { id: 'o3', kind: 'STAND', code: 'S2', geometry: polygon(10, 0), metadata: {} },
    { id: 'o4', kind: 'STAND', code: 'S3', geometry: polygon(15, 0), metadata: {} },
  ],
};
const STAND = {
  hasPrice: true,
  currency: 'ARS',
};
const STANDS = [
  {
    ...STAND,
    id: 'es1',
    layoutObjectId: 'o1',
    code: 'S1',
    sectorId: 'sec',
    status: 'AVAILABLE',
    priceCents: 1_740_000,
  },
  {
    ...STAND,
    id: 'es2',
    layoutObjectId: 'o3',
    code: 'S2',
    sectorId: null,
    status: 'ASSIGNED',
    priceCents: 1_000_000,
  },
];

function setup() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), HttpTenantCatalogRepository],
  });
  return {
    repo: TestBed.inject(HttpTenantCatalogRepository),
    http: TestBed.inject(HttpTestingController),
  };
}

async function loadMap(own: unknown[] | 'forbidden' = []): Promise<PublicMapDto> {
  const { repo, http } = setup();
  const map = firstValueFrom(repo.getMap('feria-1'));
  http.expectOne('/api/v1/events').flush([EVENT]);
  http.expectOne('/api/v1/layout-versions/lv1').flush(LAYOUT);
  http.expectOne('/api/v1/events/e1/stands').flush(STANDS);
  http.expectOne('/api/v1/events/e1/sectors').flush([{ id: 'sec', name: 'Diseño' }]);
  const reservations = http.expectOne('/api/v1/reservations?eventId=e1');
  if (own === 'forbidden') reservations.flush({}, { status: 403, statusText: 'Forbidden' });
  else reservations.flush(own);
  return map;
}

describe('HttpTenantCatalogRepository (exhibitor stands, real API)', () => {
  it('lists the events on sale by slug and name', async () => {
    const { repo, http } = setup();
    const events = firstValueFrom(repo.listEvents());
    http.expectOne('/api/v1/events').flush([EVENT]);
    expect((await events).map((e) => [e.slug, e.name, e.salesOpen])).toEqual([
      ['feria-1', 'Feria 1', true],
    ]);
  });

  it('builds the plan from layout, stands and sectors; stands not in the event are left out', async () => {
    const map = await loadMap();
    expect(map.bounds).toEqual({ width: 20, height: 10 });
    expect(map.layoutVersion).toBe(3);
    const stands = standsOf(map);
    expect(stands.map((s) => [s.id, s.code, s.status, s.sector, s.areaM2, s.priceCents])).toEqual([
      ['es1', 'S1', 'AVAILABLE', 'Diseño', 9, 1_740_000],
      ['es2', 'S2', 'OCCUPIED', null, 9, 1_000_000],
    ]);
    // The aisle stays on the plan as an area; the stand without an event stand (S3) does not.
    expect(map.features).toHaveLength(3);
  });

  it('shows the exhibitor’s own live reservation as reserved', async () => {
    const map = await loadMap([{ status: 'HELD', stand: { id: 'es1' } }]);
    expect(standsOf(map)[0].status).toBe('RESERVED');
  });

  it('still draws the plan when the own reservations cannot be read', async () => {
    const map = await loadMap('forbidden');
    expect(standsOf(map)[0].status).toBe('AVAILABLE');
  });

  it('fails with a not-found error for an event that is not on sale', async () => {
    const { repo, http } = setup();
    const map = firstValueFrom(repo.getMap('otra'));
    http.expectOne('/api/v1/events').flush([EVENT]);
    await expect(map).rejects.toBeInstanceOf(PublicEventNotFoundError);
  });
});

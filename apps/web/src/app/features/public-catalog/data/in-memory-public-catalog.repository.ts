import { defer, of, type Observable } from 'rxjs';
import { DEMO_LAYOUT } from '../../layout-editor/data/demo-layout';
import { fromPolygon, round2 } from '../../layout-editor/domain/geometry';
import { KIND_LABEL } from '../../layout-editor/domain/validation';
import {
  PublicCatalogRepository,
  PublicEventNotFoundError,
  type MapFeature,
  type PublicExhibitorDto,
  type PublicEventSummaryDto,
  type PublicMapDto,
  type PublicStandStatus,
} from './public-catalog.repository';

export const DEMO_EVENT_SLUG = 'patagonia-emprende-2026';

/** Demo sectors by row (ADR 0002: sectors belong to the event) and fictitious prices per sector. */
const SECTORS: Readonly<Record<string, { name: string; priceCents: number }>> = {
  A: { name: 'Diseño y moda', priceCents: 17_400_000 },
  B: { name: 'Producción regional', priceCents: 10_800_000 },
  C: { name: 'Patio gastronómico', priceCents: 14_000_000 },
  D: { name: 'Servicios y oficios', priceCents: 11_800_000 },
};

// Consistent with the Panel (demo metrics): 3 in-progress reservations, 23 assigned, 2 blocked.
const BLOCKED = new Set(['D09', 'D10']);
const RESERVED = new Set(['A06', 'B02', 'C05']);
const AVAILABLE = new Set([
  'A02',
  'A08',
  'B04',
  'B07',
  'B09',
  'C01',
  'C04',
  'C08',
  'D02',
  'D05',
  'D06',
  'D07',
]);

/** Fictitious exhibitors on occupied stands; `isPublic: false` means no consent (AC-11). */
const EXHIBITORS: readonly {
  code: string;
  name: string;
  category: string;
  description: string;
  isPublic: boolean;
}[] = [
  {
    code: 'A01',
    name: 'Lanas del Limay',
    category: 'Textil de autor',
    description: 'Hilados y tejidos con lana de oveja de la meseta.',
    isPublic: true,
  },
  {
    code: 'A03',
    name: 'Barro Cordillerano',
    category: 'Cerámica',
    description: 'Vajilla de gres hecha a mano.',
    isPublic: true,
  },
  {
    code: 'A04',
    name: 'Verde Ruca',
    category: 'Cosmética natural',
    description: 'Cremas y aceites con plantas nativas.',
    isPublic: true,
  },
  {
    code: 'A05',
    name: 'Jabonería Lafken',
    category: 'Cosmética natural',
    description: 'Jabones de glicerina con aromas del lago.',
    isPublic: true,
  },
  {
    code: 'B01',
    name: 'Taller Confluencia',
    category: 'Diseño de objetos',
    description: 'Luminarias y objetos en madera reciclada.',
    isPublic: true,
  },
  {
    code: 'B03',
    name: 'Cuero Austral',
    category: 'Marroquinería',
    description: 'Bolsos y cinturones de cuero curtido vegetal.',
    isPublic: true,
  },
  {
    code: 'B05',
    name: 'Frutos del Alto Valle',
    category: 'Productos regionales',
    description: 'Dulces y frutas deshidratadas.',
    isPublic: true,
  },
  {
    code: 'C02',
    name: 'Cafetería Viento Sur',
    category: 'Gastronomía',
    description: 'Café de especialidad y pastelería.',
    isPublic: true,
  },
  {
    code: 'C03',
    name: 'Cordero & Lúpulo',
    category: 'Gastronomía',
    description: 'Sándwiches de cordero y maridajes.',
    isPublic: false,
  },
  {
    code: 'C06',
    name: 'Miel del Valle',
    category: 'Productos regionales',
    description: 'Miel multifloral del Alto Valle.',
    isPublic: false,
  },
];

function statusOf(code: string): PublicStandStatus {
  if (BLOCKED.has(code)) return 'BLOCKED';
  if (RESERVED.has(code)) return 'RESERVED';
  if (AVAILABLE.has(code)) return 'AVAILABLE';
  return 'OCCUPIED';
}

function demoMap(): PublicMapDto {
  const features: MapFeature[] = DEMO_LAYOUT.objects.map((o) => {
    if (o.kind !== 'STAND') {
      return {
        type: 'Feature',
        geometry: o.geometry,
        properties: { kind: o.kind, label: KIND_LABEL[o.kind] },
      };
    }
    const code = o.code ?? '';
    const sector = SECTORS[code.charAt(0)];
    const rect = fromPolygon(o.geometry);
    const status = statusOf(code);
    const exhibitor = EXHIBITORS.find(
      (e) => e.code === code && e.isPublic && status === 'OCCUPIED',
    );
    return {
      type: 'Feature',
      geometry: o.geometry,
      properties: {
        kind: 'STAND',
        standId: o.id,
        code,
        areaM2: rect ? round2(rect.w * rect.h) : 0,
        status,
        sector: sector?.name ?? null,
        price: { currency: 'ARS', valueCents: sector?.priceCents ?? 0 },
        exhibitor: exhibitor
          ? {
              name: exhibitor.name,
              category: exhibitor.category,
              description: exhibitor.description,
              photos: [],
              media: [],
            }
          : null,
      },
    };
  });
  return {
    slug: DEMO_EVENT_SLUG,
    layoutVersion: DEMO_LAYOUT.version,
    units: 'm',
    bounds: { width: DEMO_LAYOUT.widthM, height: DEMO_LAYOUT.heightM },
    features,
  };
}

const DEMO_MAP = demoMap();
const demoStands = DEMO_MAP.features.flatMap((f) =>
  f.properties.kind === 'STAND' ? [f.properties] : [],
);

const EVENTS: readonly PublicEventSummaryDto[] = [
  {
    slug: DEMO_EVENT_SLUG,
    name: 'Patagonia Emprende 2026',
    organizerName: 'Asociación Patagonia Emprende',
    venueName: 'Espacio Duam',
    venueAddress: 'Av. Olascoaga 100, Neuquén',
    startsAt: '2026-11-20T13:00:00Z',
    endsAt: '2026-11-22T23:00:00Z',
    salesOpen: true,
    availableStands: demoStands.filter((s) => s.status === 'AVAILABLE').length,
    totalStands: demoStands.length,
  },
  {
    slug: 'feria-del-litoral-artesanal',
    name: 'Feria del Litoral Artesanal',
    organizerName: 'Litoral Artesanal',
    venueName: 'Galpón 13',
    venueAddress: null,
    startsAt: '2026-12-05T13:00:00Z',
    endsAt: '2026-12-07T23:00:00Z',
    salesOpen: true,
    availableStands: 10,
    totalStands: 18,
  },
  {
    slug: 'mendoza-sabores-y-diseno',
    name: 'Mendoza Sabores & Diseño',
    organizerName: 'Sabores & Diseño',
    venueName: 'Nave Cultural',
    venueAddress: null,
    startsAt: '2027-03-12T13:00:00Z',
    endsAt: '2027-03-14T23:00:00Z',
    salesOpen: false,
    availableStands: 0,
    totalStands: 0,
  },
];

const DIRECTORY: readonly PublicExhibitorDto[] = EXHIBITORS.filter((e) => e.isPublic).map((e) => ({
  name: e.name,
  category: e.category,
  description: e.description,
  standCode: e.code,
}));

/** Stand-in for PUB-01 (`/api/v1/public/events…`). Fictitious data, consistent with the demo Panel. */
export class InMemoryPublicCatalogRepository extends PublicCatalogRepository {
  listEvents(): Observable<readonly PublicEventSummaryDto[]> {
    return defer(() => of(EVENTS));
  }

  getMap(slug: string): Observable<PublicMapDto> {
    return defer(() => {
      if (slug !== DEMO_EVENT_SLUG) throw new PublicEventNotFoundError(slug);
      return of(DEMO_MAP);
    });
  }

  listExhibitors(slug: string): Observable<readonly PublicExhibitorDto[]> {
    return defer(() => {
      if (slug !== DEMO_EVENT_SLUG) throw new PublicEventNotFoundError(slug);
      return of(DIRECTORY);
    });
  }
}

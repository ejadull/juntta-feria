import type { LayoutObjectDto, LayoutVersionDto } from '../../layout-editor/domain/layout.types';
import { fromPolygon, round2 } from '../../layout-editor/domain/geometry';
import { KIND_LABEL } from '../../layout-editor/domain/validation';
import type { MapFeature, PublicMapDto, PublicStandStatus } from './public-catalog.repository';

/** `GET /events/:id/stands` item (EVT-01). */
export interface ApiEventStand {
  readonly id: string;
  readonly layoutObjectId: string;
  readonly code: string;
  readonly sectorId: string | null;
  readonly status: 'AVAILABLE' | 'BLOCKED' | 'ASSIGNED' | 'DISABLED';
  readonly priceCents: number;
  readonly hasPrice: boolean;
  readonly currency: string;
}

export interface ApiEventSector {
  readonly id: string;
  readonly name: string;
}

const STATUS: Readonly<Record<ApiEventStand['status'], PublicStandStatus>> = {
  AVAILABLE: 'AVAILABLE',
  ASSIGNED: 'OCCUPIED',
  BLOCKED: 'BLOCKED',
  DISABLED: 'BLOCKED',
};

export interface MapSources {
  readonly slug: string;
  readonly layout: Pick<LayoutVersionDto, 'version' | 'widthM' | 'heightM' | 'objects'>;
  readonly stands: readonly ApiEventStand[];
  readonly sectors: readonly ApiEventSector[];
  /** Event stands the caller already holds or is paying for: shown as reserved. */
  readonly ownStandIds: ReadonlySet<string>;
}

function feature(object: LayoutObjectDto, sources: MapSources): MapFeature | null {
  if (object.kind !== 'STAND')
    return {
      type: 'Feature',
      geometry: object.geometry,
      properties: { kind: object.kind, label: KIND_LABEL[object.kind] },
    };
  const stand = sources.stands.find((s) => s.layoutObjectId === object.id);
  if (!stand) return null;
  const rect = fromPolygon(object.geometry);
  const status = stand.hasPrice ? STATUS[stand.status] : 'BLOCKED';
  return {
    type: 'Feature',
    geometry: object.geometry,
    properties: {
      kind: 'STAND',
      standId: stand.id,
      code: stand.code,
      areaM2: rect ? round2(rect.w * rect.h) : 0,
      status: status === 'AVAILABLE' && sources.ownStandIds.has(stand.id) ? 'RESERVED' : status,
      sector: sources.sectors.find((s) => s.id === stand.sectorId)?.name ?? null,
      price: { currency: 'ARS', valueCents: stand.priceCents },
      exhibitor: null,
    },
  };
}

/** Builds the stand map from the real endpoints; stands the event does not sell are left out. */
export function toPublicMap(sources: MapSources): PublicMapDto {
  const { layout } = sources;
  return {
    slug: sources.slug,
    layoutVersion: layout.version,
    units: 'm',
    bounds: { width: layout.widthM, height: layout.heightM },
    features: layout.objects.flatMap((o) => feature(o, sources) ?? []),
  };
}

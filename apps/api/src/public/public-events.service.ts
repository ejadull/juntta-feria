import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService, type Transaction } from '../db/database.service.js';
import {
  eventSectors,
  events,
  eventStands,
  exhibitorCategories,
  exhibitorPhotos,
  exhibitors,
  layoutObjects,
  layoutVersions,
  reservations,
} from '../db/schema.js';
import { PHOTO_URL_TTL_SECONDS } from '../exhibitors/photo-policy.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../storage/object-storage.js';
import {
  photoFallbackAlt,
  publicExhibitorOf,
  type PublicPhoto,
  type PublicStandExhibitor,
} from './public-exhibitor.js';

/** Shown when an exhibitor has no rubro yet (EXH-02 keeps `category_id` nullable). */
const NO_CATEGORY = 'Sin rubro';

export type PublicStandStatus =
  'AVAILABLE' | 'RESERVED' | 'OCCUPIED' | 'BLOCKED';

/** Item of `GET /public/events`. Only what an organizer would print on a poster. */
export interface PublicEventSummary {
  readonly slug: string;
  readonly name: string;
  readonly organizerName: string;
  readonly venueName: string;
  readonly venueAddress: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly salesOpen: boolean;
  readonly availableStands: number;
  readonly totalStands: number;
}

export interface PublicEventDetail extends PublicEventSummary {
  readonly sectors: readonly string[];
}

export interface PublicStandProperties {
  readonly kind: 'STAND';
  readonly standId: string;
  readonly code: string;
  readonly areaM2: number;
  readonly status: PublicStandStatus;
  readonly sector: string | null;
  readonly price: { readonly currency: 'ARS'; readonly valueCents: number };
  /** Only exhibitors that consented to a public profile (AC-11, INV-08). */
  readonly exhibitor: PublicStandExhibitor | null;
}

export interface PublicAreaProperties {
  readonly kind: 'AISLE' | 'ENTRY' | 'EXIT';
  readonly label: string | null;
}

export interface PublicMapFeature {
  readonly type: 'Feature';
  readonly geometry: { type: 'Polygon'; coordinates: [number, number][][] };
  readonly properties: PublicStandProperties | PublicAreaProperties;
}

export interface PublicMap {
  readonly slug: string;
  readonly layoutVersion: number;
  readonly units: 'm';
  readonly bounds: { readonly width: number; readonly height: number };
  readonly features: readonly PublicMapFeature[];
}

export interface PublicExhibitor {
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly standCode: string | null;
}

export const PUBLIC_EVENT_NOT_FOUND = 'Event not found.';
/** Not published: emergency routes and utilities are operational data, not map content. */
const PUBLIC_KINDS = ['STAND', 'AISLE', 'ENTRY', 'EXIT'] as const;
const HELD = ['HELD', 'PAYMENT_PENDING'] as const;
const OWNING = ['CONFIRMED', 'REFUND_PENDING'] as const;

interface ListRow extends Record<string, unknown> {
  slug: string;
  name: string;
  tenant_name: string;
  venue_name: string;
  venue_address: string | null;
  starts_at: Date | string;
  ends_at: Date | string;
  sales_open_at: Date | string;
  sales_close_at: Date | string;
  total_stands: number;
  available_stands: number;
}

const isOwning = (status: string | null): boolean =>
  status !== null && (OWNING as readonly string[]).includes(status);
const isHeld = (status: string | null): boolean =>
  status !== null && (HELD as readonly string[]).includes(status);

const summaryOf = (row: ListRow, now: Date): PublicEventSummary => ({
  slug: row.slug,
  name: row.name,
  organizerName: row.tenant_name,
  venueName: row.venue_name,
  venueAddress: row.venue_address,
  startsAt: new Date(row.starts_at),
  endsAt: new Date(row.ends_at),
  salesOpen:
    new Date(row.sales_open_at) <= now && now <= new Date(row.sales_close_at),
  availableStands: row.available_stands,
  totalStands: row.total_stands,
});

/** Visitors only learn availability, never who holds a stand or why it is blocked. */
function visitorStatus(stand: {
  status: string;
  priceCents: number | null;
  reservation: string | null;
}): PublicStandStatus {
  if (isOwning(stand.reservation) || stand.status === 'ASSIGNED')
    return 'OCCUPIED';
  if (isHeld(stand.reservation)) return 'RESERVED';
  if (stand.status === 'BLOCKED' || stand.priceCents === null) return 'BLOCKED';
  return 'AVAILABLE';
}

/**
 * Public portal reads (PUB-01). No session and no tenant header: the only cross-tenant reads are
 * the SECURITY DEFINER functions of migration 0019; the rest runs in `withTenant` under RLS with
 * explicit column lists, so nothing private (contacts, tax ids, reservations, payments) can be
 * selected by accident. Events that are not PUBLISHED/ACTIVE do not exist for this service.
 */
@Injectable()
export class PublicEventsService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async list(now = new Date()): Promise<PublicEventSummary[]> {
    const { rows } = await this.database.db.execute<ListRow>(
      sql`SELECT * FROM public_event_list()`,
    );
    return rows.map((row) => summaryOf(row, now));
  }

  async detail(slug: string, now = new Date()): Promise<PublicEventDetail> {
    const target = await this.resolve(slug);
    const { rows } = await this.database.db.execute<ListRow>(
      sql`SELECT * FROM public_event_list() WHERE slug = ${slug}`,
    );
    if (rows.length === 0) throw new NotFoundException(PUBLIC_EVENT_NOT_FOUND);
    const sectors = await this.database.withTenant(target.tenantId, (tx) =>
      tx
        .select({ name: eventSectors.name })
        .from(eventSectors)
        .where(eq(eventSectors.eventId, target.id))
        .orderBy(asc(eventSectors.sortOrder), asc(eventSectors.name)),
    );
    return {
      ...summaryOf(rows[0], now),
      sectors: sectors.map((s) => s.name),
    };
  }

  async map(slug: string): Promise<PublicMap> {
    const target = await this.resolve(slug);
    return this.database.withTenant(target.tenantId, async (tx) => {
      const [layout] = await tx
        .select({
          version: layoutVersions.version,
          widthM: layoutVersions.widthM,
          heightM: layoutVersions.heightM,
        })
        .from(events)
        .innerJoin(
          layoutVersions,
          and(
            eq(layoutVersions.tenantId, events.tenantId),
            eq(layoutVersions.id, events.layoutVersionId),
          ),
        )
        .where(eq(events.id, target.id));
      if (!layout) throw new NotFoundException(PUBLIC_EVENT_NOT_FOUND);

      const objects = await tx
        .select({
          id: layoutObjects.id,
          kind: layoutObjects.kind,
          code: layoutObjects.code,
          areaM2: sql<string>`round(ST_Area(${layoutObjects.geometry})::numeric, 2)`,
          geometry: sql<
            PublicMapFeature['geometry']
          >`ST_AsGeoJSON(${layoutObjects.geometry})::json`,
        })
        .from(layoutObjects)
        .innerJoin(
          events,
          eq(events.layoutVersionId, layoutObjects.layoutVersionId),
        )
        .where(
          and(
            eq(events.id, target.id),
            inArray(layoutObjects.kind, [...PUBLIC_KINDS]),
          ),
        )
        .orderBy(asc(layoutObjects.kind), asc(layoutObjects.code));

      const stands = await tx
        .select({
          id: eventStands.id,
          layoutObjectId: eventStands.layoutObjectId,
          code: eventStands.code,
          status: eventStands.status,
          priceCents: eventStands.priceCents,
          sector: eventSectors.name,
          reservation: reservations.status,
          exhibitorId: exhibitors.id,
          exhibitorName: exhibitors.tradeName,
          exhibitorCategory: sql<string>`coalesce(${exhibitorCategories.name}, ${NO_CATEGORY})`,
          exhibitorDescription: exhibitors.description,
          exhibitorPublic: exhibitors.publicContactOptIn,
        })
        .from(eventStands)
        .leftJoin(
          eventSectors,
          and(
            eq(eventSectors.tenantId, eventStands.tenantId),
            eq(eventSectors.id, eventStands.sectorId),
          ),
        )
        .leftJoin(
          reservations,
          and(
            eq(reservations.eventStandId, eventStands.id),
            inArray(reservations.status, [...HELD, ...OWNING]),
          ),
        )
        .leftJoin(
          exhibitors,
          and(
            eq(exhibitors.tenantId, reservations.tenantId),
            eq(exhibitors.id, reservations.exhibitorId),
          ),
        )
        .leftJoin(
          exhibitorCategories,
          and(
            eq(exhibitorCategories.tenantId, exhibitors.tenantId),
            eq(exhibitorCategories.id, exhibitors.categoryId),
          ),
        )
        .where(eq(eventStands.eventId, target.id));
      const byObject = new Map(stands.map((s) => [s.layoutObjectId, s]));
      // Only exhibitors that own a stand AND consented: photos are never looked up otherwise.
      const consentedIds = [
        ...new Set(
          stands.flatMap((s) =>
            s.exhibitorId && s.exhibitorPublic && isOwning(s.reservation)
              ? [s.exhibitorId]
              : [],
          ),
        ),
      ];
      const photosByExhibitor = await this.photosOf(tx, consentedIds);

      const features = objects.flatMap((object): PublicMapFeature[] => {
        if (object.kind !== 'STAND')
          return [
            {
              type: 'Feature' as const,
              geometry: object.geometry,
              properties: {
                kind: object.kind as 'AISLE' | 'ENTRY' | 'EXIT',
                label: object.code?.trim() || null,
              },
            },
          ];
        const stand = byObject.get(object.id);
        if (!stand || stand.status === 'DISABLED') return [];
        return [
          {
            type: 'Feature' as const,
            geometry: object.geometry,
            properties: {
              kind: 'STAND' as const,
              standId: stand.id,
              code: stand.code,
              areaM2: Number(object.areaM2),
              status: visitorStatus(stand),
              sector: stand.sector,
              price: {
                currency: 'ARS' as const,
                valueCents: stand.priceCents ?? 0,
              },
              exhibitor: publicExhibitorOf(
                {
                  reservationOwns: isOwning(stand.reservation),
                  consented: stand.exhibitorPublic,
                  exhibitorId: stand.exhibitorId,
                  name: stand.exhibitorName,
                  category: stand.exhibitorCategory,
                  description: stand.exhibitorDescription,
                },
                photosByExhibitor,
              ),
            },
          },
        ];
      });
      return {
        slug,
        layoutVersion: layout.version,
        units: 'm' as const,
        bounds: { width: layout.widthM, height: layout.heightM },
        features,
      };
    });
  }

  /** READY photos of the given (already consented) exhibitors, presigned for an hour. */
  private async photosOf(
    tx: Transaction,
    exhibitorIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly PublicPhoto[]>> {
    if (exhibitorIds.length === 0) return new Map();
    const rows = await tx
      .select({
        exhibitorId: exhibitorPhotos.exhibitorId,
        storageKey: exhibitorPhotos.storageKey,
        contentType: exhibitorPhotos.contentType,
        alt: exhibitorPhotos.alt,
        exhibitorName: exhibitors.tradeName,
      })
      .from(exhibitorPhotos)
      .innerJoin(
        exhibitors,
        and(
          eq(exhibitors.tenantId, exhibitorPhotos.tenantId),
          eq(exhibitors.id, exhibitorPhotos.exhibitorId),
        ),
      )
      .where(
        and(
          inArray(exhibitorPhotos.exhibitorId, [...exhibitorIds]),
          eq(exhibitorPhotos.status, 'READY'),
          eq(exhibitors.publicContactOptIn, true),
        ),
      )
      .orderBy(asc(exhibitorPhotos.position), asc(exhibitorPhotos.createdAt));
    const signed = await Promise.all(
      rows.map(async (row) => ({
        exhibitorId: row.exhibitorId,
        photo: {
          url: await this.storage.presignDownload({
            key: row.storageKey,
            fileName: 'foto',
            contentType: row.contentType,
            expiresInSeconds: PHOTO_URL_TTL_SECONDS,
            inline: true,
          }),
          alt: row.alt?.trim() || photoFallbackAlt(row.exhibitorName),
        },
      })),
    );
    const byExhibitor = new Map<string, PublicPhoto[]>();
    for (const { exhibitorId, photo } of signed)
      byExhibitor.set(exhibitorId, [
        ...(byExhibitor.get(exhibitorId) ?? []),
        photo,
      ]);
    return byExhibitor;
  }

  async exhibitors(slug: string): Promise<PublicExhibitor[]> {
    const target = await this.resolve(slug);
    return this.database.withTenant(target.tenantId, (tx) =>
      tx
        .select({
          name: exhibitors.tradeName,
          category: sql<string>`coalesce(${exhibitorCategories.name}, ${NO_CATEGORY})`,
          description: exhibitors.description,
          standCode: eventStands.code,
        })
        .from(reservations)
        .innerJoin(
          eventStands,
          and(
            eq(eventStands.tenantId, reservations.tenantId),
            eq(eventStands.id, reservations.eventStandId),
          ),
        )
        .innerJoin(
          exhibitors,
          and(
            eq(exhibitors.tenantId, reservations.tenantId),
            eq(exhibitors.id, reservations.exhibitorId),
          ),
        )
        .leftJoin(
          exhibitorCategories,
          and(
            eq(exhibitorCategories.tenantId, exhibitors.tenantId),
            eq(exhibitorCategories.id, exhibitors.categoryId),
          ),
        )
        .where(
          and(
            eq(eventStands.eventId, target.id),
            inArray(reservations.status, [...OWNING]),
            eq(exhibitors.publicContactOptIn, true),
          ),
        )
        .orderBy(asc(exhibitors.tradeName), asc(eventStands.code)),
    );
  }

  /** Event on sale of any tenant, by its globally unique slug; anything else is a 404. */
  private async resolve(
    slug: string,
  ): Promise<{ id: string; tenantId: string }> {
    const { rows } = await this.database.db.execute<{
      id: string;
      tenant_id: string;
    }>(sql`SELECT id, tenant_id FROM public_event_lookup(${slug})`);
    if (rows.length === 0) throw new NotFoundException(PUBLIC_EVENT_NOT_FOUND);
    return { id: rows[0].id, tenantId: rows[0].tenant_id };
  }
}

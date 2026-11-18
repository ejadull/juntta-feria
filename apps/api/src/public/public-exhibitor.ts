/** Photo of a public exhibitor profile. `url` is a short-lived presigned GET; never a storage key. */
export interface PublicPhoto {
  readonly url: string;
  readonly alt: string;
}

/**
 * A publication of the event being viewed (change exh-media-share). Only READY, not hidden, and
 * only while the event has not ended; `url` is a presigned GET, never a storage key.
 */
export interface PublicMedia {
  readonly id: string;
  readonly kind: 'IMAGE' | 'VIDEO';
  readonly url: string;
  readonly alt: string;
  readonly caption: string | null;
  readonly durationS: number | null;
}

export interface PublicStandExhibitor {
  readonly name: string;
  readonly category: string;
  /** Same consent as name and category; null when the exhibitor wrote none. */
  readonly description: string | null;
  /** READY profile photos in position order; empty without photos. */
  readonly photos: readonly PublicPhoto[];
  /** Publications of this event, in position order; empty without consent or publications. */
  readonly media: readonly PublicMedia[];
}

export interface StandExhibitorRow {
  readonly reservationOwns: boolean;
  readonly consented: boolean | null;
  readonly exhibitorId: string | null;
  readonly name: string | null;
  readonly category: string | null;
  readonly description: string | null;
}

/** Used when the exhibitor wrote no alt text for a photo. */
export const photoFallbackAlt = (exhibitorName: string): string =>
  `Foto del stand de ${exhibitorName}`;

/**
 * The only place that decides what a visitor learns about an exhibitor: nothing unless the stand
 * is owned (confirmed reservation) AND the exhibitor opted in to a public profile (AC-11, INV-08).
 * Photos follow the same consent: without it they are not even looked up.
 */
export function publicExhibitorOf(
  row: StandExhibitorRow,
  photosByExhibitor: ReadonlyMap<string, readonly PublicPhoto[]>,
  mediaByExhibitor: ReadonlyMap<string, readonly PublicMedia[]> = new Map(),
): PublicStandExhibitor | null {
  if (!row.reservationOwns || row.consented !== true) return null;
  if (row.exhibitorId === null || row.name === null || row.category === null)
    return null;
  return {
    name: row.name,
    category: row.category,
    description: row.description?.trim() || null,
    photos: photosByExhibitor.get(row.exhibitorId) ?? [],
    media: mediaByExhibitor.get(row.exhibitorId) ?? [],
  };
}

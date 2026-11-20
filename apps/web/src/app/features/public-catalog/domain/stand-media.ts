/** A publication of the exhibitor (change exh-media-share). `url` is a short-lived signed link. */
export interface StandMedia {
  readonly id: string;
  readonly kind: 'IMAGE' | 'VIDEO';
  readonly url: string;
  readonly alt: string;
  readonly caption: string | null;
  readonly durationS: number | null;
}

interface ExhibitorMedia {
  readonly name: string;
  readonly photos: readonly { readonly url: string; readonly alt: string }[];
  readonly media: readonly StandMedia[];
}

/** One entry of the stand gallery; videos keep their duration, images always have text. */
export interface GalleryItem {
  readonly id: string;
  readonly kind: 'IMAGE' | 'VIDEO';
  readonly url: string;
  readonly alt: string;
  readonly caption: string | null;
  readonly durationS: number | null;
}

/**
 * The stand gallery: publications first, then profile photos. The publication a share link points
 * to goes first, so the visitor lands on it.
 */
export function galleryOf(
  exhibitor: ExhibitorMedia | null,
  highlightId: string | null,
): GalleryItem[] {
  if (!exhibitor) return [];
  const publications: GalleryItem[] = exhibitor.media.map((m) => ({
    id: m.id,
    kind: m.kind,
    url: m.url,
    alt: m.alt || m.caption || exhibitor.name,
    caption: m.caption,
    durationS: m.durationS,
  }));
  const profile: GalleryItem[] = exhibitor.photos.map((p, i) => ({
    id: `profile-${i}`,
    kind: 'IMAGE',
    url: p.url,
    alt: p.alt || exhibitor.name,
    caption: null,
    durationS: null,
  }));
  const all = [...publications, ...profile];
  const highlighted = all.filter((item) => item.id === highlightId);
  return [...highlighted, ...all.filter((item) => item.id !== highlightId)];
}

/** The stand whose exhibitor published the given item, if it is on this plan. */
export function standForPublication<
  T extends { readonly exhibitor: { readonly media: readonly { readonly id: string }[] } | null },
>(stands: readonly T[], mediaId: string): T | null {
  return stands.find((stand) => stand.exhibitor?.media.some((m) => m.id === mediaId)) ?? null;
}

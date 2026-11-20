/**
 * Sharing one publication (change exh-media-share, MED-08). When the browser can share files, its
 * own menu offers the apps (WhatsApp, Facebook and Instagram on a phone) with the file attached.
 * Otherwise the visitor gets links: WhatsApp, Facebook, copy and download. No third-party SDK.
 */
export interface SharedItem {
  /** Share page of the publication (`/api/v1/public/share/:id`): it carries the preview tags. */
  readonly pageUrl: string;
  /** Presigned file of the publication. */
  readonly url: string;
  readonly contentType: string;
  readonly caption: string | null;
  readonly exhibitorName: string;
}

export interface ShareOption {
  readonly id: 'whatsapp' | 'facebook' | 'copy' | 'download';
  readonly label: string;
  /** Absent for `copy`, which copies `pageUrl` instead of navigating. */
  readonly href?: string;
}

export type ShareOutcome =
  | { readonly kind: 'shared' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'options'; readonly options: readonly ShareOption[] };

/** The browser's share capabilities, injected so the rules can be tested without a browser. */
export interface ShareEnv {
  readonly share?: (data: ShareData) => Promise<void>;
  readonly canShare?: (data: ShareData) => boolean;
  /** Downloads the publication's file to attach it; null when it cannot be read. */
  readonly fetchFile: (url: string, type: string) => Promise<File | null>;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** Text sent with the link: the caption (or a generic line) and the exhibitor, then the page. */
function messageOf(item: SharedItem): string {
  const who = item.caption
    ? `${item.caption} · ${item.exhibitorName}`
    : `Publicación de ${item.exhibitorName}`;
  return `${who} — ${item.pageUrl}`;
}

/** WhatsApp and Facebook links for the share page of one publication. */
export function linksFor(item: SharedItem): { whatsapp: string; facebook: string } {
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(messageOf(item))}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(item.pageUrl)}`,
  };
}

function optionsFor(item: SharedItem): ShareOption[] {
  const links = linksFor(item);
  return [
    { id: 'whatsapp', label: 'WhatsApp', href: links.whatsapp },
    { id: 'facebook', label: 'Facebook', href: links.facebook },
    { id: 'copy', label: 'Copiar link' },
    { id: 'download', label: 'Descargar archivo', href: item.url },
  ];
}

const isAbort = (error: unknown): boolean =>
  (error as { name?: string } | null)?.name === 'AbortError';

/**
 * Shares one publication. With the native menu, the file goes with the share page link; the user
 * closing that menu is not an error. Without it, the visitor chooses from the returned options.
 */
export async function shareMedia(item: SharedItem, env: ShareEnv): Promise<ShareOutcome> {
  if (env.share && env.canShare) {
    const file = await env.fetchFile(item.url, item.contentType).catch(() => null);
    if (file) {
      const data: ShareData = {
        title: item.caption ?? item.exhibitorName,
        text: messageOf(item),
        url: item.pageUrl,
        files: [file],
      };
      if (env.canShare(data)) {
        try {
          await env.share(data);
          return { kind: 'shared' };
        } catch (error: unknown) {
          if (isAbort(error)) return { kind: 'cancelled' };
        }
      }
    }
  }
  return { kind: 'options', options: optionsFor(item) };
}

/** The real browser: its share menu when there is one, and the file fetched from storage. */
export function browserShareEnv(): ShareEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return {
    share: nav?.share ? (data) => nav.share(data) : undefined,
    canShare: nav?.canShare ? (data) => nav.canShare(data) : undefined,
    fetchFile: async (url, type) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const blob = await response.blob();
        const ext = EXTENSIONS[type] ?? 'bin';
        return new File([blob], `publicacion.${ext}`, { type });
      } catch {
        return null;
      }
    },
  };
}

/** Copies the share link; false when the browser does not allow it. */
export async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

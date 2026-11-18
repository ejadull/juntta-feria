/**
 * The HTML that a link to one publication returns (change exh-media-share, D4). Crawlers of
 * WhatsApp and Facebook read these tags without running JavaScript; browsers follow the redirect.
 */
export interface SharePageInput {
  readonly title: string;
  readonly description: string;
  /** Absolute URL of this share page (og:url). */
  readonly pageUrl: string;
  /** Absolute URL of the fair, with the publication id (where visitors land). */
  readonly redirectUrl: string;
  /** Presigned image; WhatsApp previews use it. Null for videos without a poster. */
  readonly image: { readonly url: string; readonly type: string } | null;
  /** Presigned video, when the publication is a video. */
  readonly video: { readonly url: string; readonly type: string } | null;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Every value that reaches the page goes through here: captions are visitor-facing user text. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

const meta = (attr: 'name' | 'property', key: string, content: string): string =>
  `<meta ${attr}="${key}" content="${escapeHtml(content)}">`;

export function renderSharePage(input: SharePageInput): string {
  const media = [
    input.image ? meta('property', 'og:image', input.image.url) : '',
    input.image ? meta('property', 'og:image:type', input.image.type) : '',
    input.video ? meta('property', 'og:video', input.video.url) : '',
    input.video ? meta('property', 'og:video:type', input.video.type) : '',
  ]
    .filter(Boolean)
    .join('\n    ');
  const redirect = escapeHtml(input.redirectUrl);
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(input.title)}</title>
    ${meta('name', 'description', input.description)}
    ${meta('property', 'og:site_name', 'Juntta Feria')}
    ${meta('property', 'og:type', 'website')}
    ${meta('property', 'og:title', input.title)}
    ${meta('property', 'og:description', input.description)}
    ${meta('property', 'og:url', input.pageUrl)}
    ${media}
    ${meta('name', 'twitter:card', input.image ? 'summary_large_image' : 'summary')}
    <meta http-equiv="refresh" content="0; url=${redirect}">
    <link rel="canonical" href="${redirect}">
  </head>
  <body>
    <a href="${redirect}">Ver la publicación en Juntta Feria</a>
  </body>
</html>
`;
}

import { DOCUMENT, Injectable, inject } from '@angular/core';
import { type PreloadingStrategy, type Route } from '@angular/router';
import { EMPTY, type Observable, Subject, first, switchMap } from 'rxjs';

/** Path segments of a same-origin link (`/organizador/panel?x=1` → ['organizador', 'panel']). */
export function segmentsOf(href: string, origin: string): string[] | null {
  const url = new URL(href, origin);
  if (url.origin !== origin) return null;
  return url.pathname.split('/').filter(Boolean);
}

/** Whether a route's own path (`panel`, `eventos/:id`) appears in the link's segments. */
export function routeMatches(routePath: string, segments: readonly string[]): boolean {
  const parts = routePath.split('/');
  // A params-only path (`:id`) would match every link; its page loads with its parent instead.
  if (parts.every((part) => part.startsWith(':'))) return false;
  // ponytail: matches the route's own path anywhere in the link, not its full parent chain; a false
  // positive only downloads one extra chunk. Build full paths from the config if that ever matters.
  return segments.some((_, start) =>
    parts.every((part, i) => part.startsWith(':') || part === segments[start + i]),
  );
}

/**
 * Downloads a lazy page's code when the pointer rests on, or focus reaches, a link to it. This is
 * an SPA, so Speculation Rules (which prefetch documents) do not apply; the router preloads
 * instead. Pages without a hovered link are never fetched ahead.
 */
@Injectable({ providedIn: 'root' })
export class HoverPreloading implements PreloadingStrategy {
  private readonly requests = new Subject<string[]>();

  constructor() {
    const document = inject(DOCUMENT);
    const origin = document.location.origin;
    let last = '';
    const onIntent = (event: Event): void => {
      const link = (event.target as Element | null)?.closest?.(
        'a[href]',
      ) as HTMLAnchorElement | null;
      if (!link || link.href === last) return;
      last = link.href;
      const segments = segmentsOf(link.href, origin);
      if (segments?.length) this.requests.next(segments);
    };
    document.addEventListener('pointerover', onIntent, { passive: true });
    document.addEventListener('focusin', onIntent);
  }

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    const path = route.path;
    if (!path || path === '**') return EMPTY;
    return this.requests.pipe(
      first((segments) => routeMatches(path, segments)),
      switchMap(() => load()),
    );
  }
}

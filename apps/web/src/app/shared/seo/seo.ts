import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, Data, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { type PublicEventSummaryDto } from '../../features/public-catalog/data/public-catalog.repository';
import { APP_NAME } from '../demo-context';

/** Metadata one page declares: what search engines and AI assistants read about it. */
export interface PageSeo {
  readonly description: string;
  readonly title?: string;
  readonly noindex?: boolean;
  /** Structured data (schema.org) describing the page's main entity. */
  readonly jsonLd?: Readonly<Record<string, unknown>>;
}

/** Private areas (organizer, exhibitor, sign-in, unknown routes) are never indexed by default. */
export const PRIVATE_SEO: PageSeo = {
  description: `${APP_NAME}: gestión de ferias y reservas de stands.`,
  noindex: true,
};

const JSON_LD_ID = 'seo-jsonld';
const TIMEZONE = 'America/Argentina/Buenos_Aires';
const dateFormat = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TIMEZONE,
});

/** schema.org `Event` for a public fair; read by search engines and AI assistants alike. */
export function eventJsonLd(
  event: PublicEventSummaryDto,
  url: string,
): Readonly<Record<string, unknown>> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.name,
    startDate: event.startsAt,
    endDate: event.endsAt,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url,
    location: {
      '@type': 'Place',
      name: event.venueName,
      ...(event.venueAddress ? { address: event.venueAddress } : {}),
    },
    organizer: { '@type': 'Organization', name: event.organizerName },
  };
}

/** Page metadata for one fair: dates, venue and how many stands are still available. */
export function fairSeo(event: PublicEventSummaryDto, url: string): PageSeo {
  const from = dateFormat.format(new Date(event.startsAt));
  const to = dateFormat.format(new Date(event.endsAt));
  const when = from === to ? `el ${from}` : `del ${from} al ${to}`;
  return {
    title: `${event.name} · ${APP_NAME}`,
    description: `${event.name}, ${when}, en ${event.venueName}. ${event.availableStands} de ${event.totalStands} stands disponibles y mapa de expositores.`,
    jsonLd: eventJsonLd(event, url),
  };
}

/**
 * Serializes JSON-LD for a `<script>`: escaping `<` keeps a name such as `</script>` from closing
 * the element early.
 */
export function jsonLdText(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function deepestData(route: ActivatedRouteSnapshot): Data {
  let current = route;
  while (current.firstChild) current = current.firstChild;
  return current.data;
}

function setMeta(doc: Document, attr: 'name' | 'property', key: string, content: string): void {
  let el = doc.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = doc.createElement('meta');
    el.setAttribute(attr, key);
    doc.head.append(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(doc: Document, href: string | null): void {
  const current = doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href === null) {
    current?.remove();
    return;
  }
  const el = current ?? doc.createElement('link');
  el.setAttribute('rel', 'canonical');
  el.setAttribute('href', href);
  if (!current) doc.head.append(el);
}

function setJsonLd(doc: Document, value: Readonly<Record<string, unknown>> | undefined): void {
  const current = doc.head.querySelector(`script#${JSON_LD_ID}`);
  if (!value) {
    current?.remove();
    return;
  }
  const el = current ?? doc.createElement('script');
  el.setAttribute('type', 'application/ld+json');
  el.id = JSON_LD_ID;
  el.textContent = jsonLdText(value);
  if (!current) doc.head.append(el);
}

/**
 * Keeps the page metadata in step with the route: each route declares `data.seo`, and routes that
 * declare nothing are private. Pages with data (a fair) call `set()` again once it has loaded.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly doc = inject(DOCUMENT);
  private readonly title = inject(Title);
  private readonly router = inject(Router);

  /** Applies the metadata of each navigation. The first navigation is covered by NavigationEnd too. */
  start(): void {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.set(this.routeSeo()));
  }

  set(seo: PageSeo): void {
    const url = `${this.doc.location.origin}${this.doc.location.pathname}`;
    if (seo.title) this.title.setTitle(seo.title);
    const pageTitle = this.doc.title;
    const robots = seo.noindex ? 'noindex, nofollow' : 'index, follow';
    setMeta(this.doc, 'name', 'description', seo.description);
    setMeta(this.doc, 'name', 'robots', robots);
    setMeta(this.doc, 'property', 'og:title', pageTitle);
    setMeta(this.doc, 'property', 'og:description', seo.description);
    setMeta(this.doc, 'property', 'og:url', url);
    setMeta(this.doc, 'name', 'twitter:title', pageTitle);
    setMeta(this.doc, 'name', 'twitter:description', seo.description);
    setCanonical(this.doc, seo.noindex ? null : url);
    setJsonLd(this.doc, seo.jsonLd);
  }

  private routeSeo(): PageSeo {
    const declared = deepestData(this.router.routerState.snapshot.root)['seo'] as
      PageSeo | undefined;
    return declared ?? PRIVATE_SEO;
  }
}

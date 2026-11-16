import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { type PublicEventSummaryDto } from '../../features/public-catalog/data/public-catalog.repository';
import { SeoService, eventJsonLd, fairSeo, jsonLdText } from './seo';

const fair: PublicEventSummaryDto = {
  slug: 'feria-demo',
  name: 'Feria Demo',
  organizerName: 'Organizadora Sur',
  venueName: 'Predio Costanera',
  venueAddress: 'Av. Costanera 100',
  startsAt: '2027-03-12T13:00:00.000Z',
  endsAt: '2027-03-14T22:00:00.000Z',
  salesOpen: true,
  availableStands: 3,
  totalStands: 9,
};

const meta = (name: string): string | null =>
  document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null;
const property = (name: string): string | null =>
  document.head.querySelector<HTMLMetaElement>(`meta[property="${name}"]`)?.content ?? null;
const canonical = (): string | null =>
  document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute('href') ??
  null;
const jsonLd = (): Record<string, unknown> | null => {
  const el = document.head.querySelector('script#seo-jsonld');
  return el ? (JSON.parse(el.textContent ?? '') as Record<string, unknown>) : null;
};

describe('fairSeo', () => {
  it('describes the fair with its dates, venue and stand availability', () => {
    const seo = fairSeo(fair, 'https://app.test/ferias/feria-demo');

    expect(seo.title).toBe('Feria Demo · Juntta Feria');
    expect(seo.description).toMatch(
      /^Feria Demo, del \d+ de marzo de 2027 al \d+ de marzo de 2027/,
    );
    expect(seo.description).toContain('en Predio Costanera');
    expect(seo.description).toContain('3 de 9 stands disponibles');
    expect(seo.noindex).toBeUndefined();
  });

  it('says a single day when the fair starts and ends on the same day', () => {
    const oneDay = { ...fair, endsAt: '2027-03-12T22:00:00.000Z' };
    expect(fairSeo(oneDay, 'https://app.test/x').description).toMatch(
      /^Feria Demo, el \d+ de marzo de 2027,/,
    );
  });
});

describe('eventJsonLd', () => {
  it('maps the fair to a schema.org Event with place and organizer', () => {
    const data = eventJsonLd(fair, 'https://app.test/ferias/feria-demo');

    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Feria Demo',
      startDate: fair.startsAt,
      endDate: fair.endsAt,
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      url: 'https://app.test/ferias/feria-demo',
      location: { '@type': 'Place', name: 'Predio Costanera', address: 'Av. Costanera 100' },
      organizer: { '@type': 'Organization', name: 'Organizadora Sur' },
    });
  });

  it('omits the address when the venue has none', () => {
    const data = eventJsonLd({ ...fair, venueAddress: null }, 'https://app.test/x');
    expect(data['location']).toEqual({ '@type': 'Place', name: 'Predio Costanera' });
  });
});

describe('jsonLdText', () => {
  it('escapes "<" so a name cannot close the script element', () => {
    const text = jsonLdText({ name: '</script><script>alert(1)</script>' });

    expect(text).not.toContain('<');
    expect(JSON.parse(text)).toEqual({ name: '</script><script>alert(1)</script>' });
  });
});

describe('SeoService.set', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    for (const el of document.head.querySelectorAll(
      'meta[name], meta[property], link[rel="canonical"], script#seo-jsonld',
    )) {
      if (el.id === 'seo-website') continue;
      el.remove();
    }
  });

  it('writes description, robots, Open Graph and canonical for an indexable page', () => {
    TestBed.inject(SeoService).set({
      title: 'Ferias · Juntta Feria',
      description: 'Ferias en venta.',
    });

    expect(meta('description')).toBe('Ferias en venta.');
    expect(meta('robots')).toBe('index, follow');
    expect(property('og:description')).toBe('Ferias en venta.');
    expect(property('og:title')).toBe('Ferias · Juntta Feria');
    expect(canonical()).toBe(`${location.origin}${location.pathname}`);
    expect(document.title).toBe('Ferias · Juntta Feria');
  });

  it('marks private pages noindex and drops the canonical', () => {
    const seo = TestBed.inject(SeoService);
    seo.set({ description: 'Ferias en venta.' });
    seo.set({ description: 'Área privada.', noindex: true });

    expect(meta('robots')).toBe('noindex, nofollow');
    expect(canonical()).toBeNull();
  });

  it('adds structured data, then replaces it, then removes it', () => {
    const seo = TestBed.inject(SeoService);
    seo.set({ description: 'Feria A.', jsonLd: { '@type': 'Event', name: 'A' } });
    expect(jsonLd()).toEqual({ '@type': 'Event', name: 'A' });

    seo.set({ description: 'Feria B.', jsonLd: { '@type': 'Event', name: 'B' } });
    expect(jsonLd()).toEqual({ '@type': 'Event', name: 'B' });
    expect(document.head.querySelectorAll('script#seo-jsonld')).toHaveLength(1);

    seo.set({ description: 'Sin datos.' });
    expect(jsonLd()).toBeNull();
  });
});

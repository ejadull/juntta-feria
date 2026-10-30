import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { InMemoryPublicCatalogRepository } from './data/in-memory-public-catalog.repository';
import { PublicCatalogRepository } from './data/public-catalog.repository';
import { FairMapPage } from './fair-map.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function render(slug = 'patagonia-emprende-2026') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PublicCatalogRepository, useValue: new InMemoryPublicCatalogRepository() },
    ],
  });
  const fixture = TestBed.createComponent(FairMapPage);
  fixture.componentRef.setInput('slug', slug);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const click = async (el: Element) => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true })); // SVG has no .click() in jsdom
    await fixture.whenStable();
  };
  return { host, click };
}

describe('FairMapPage (PUB-UI-05)', () => {
  it('shows the fair name, the plan and the public directory', async () => {
    const { host } = await render();
    expect(plain(host.querySelector('h1')?.textContent)).toBe('Patagonia Emprende 2026');
    expect(host.querySelectorAll('app-stand-map g.stand')).toHaveLength(40);
    const directory = plain(host.querySelector('.directory')?.textContent);
    expect(directory).toContain('Lanas del Limay');
    expect(directory).toContain('Textil de autor');
    expect(directory).toContain('Hilados y tejidos');
    expect(directory).toContain('A01');
  });

  it('never shows exhibitors without consent nor private data (spec: "Directorio público")', async () => {
    const { host } = await render();
    const text = host.textContent ?? '';
    expect(text).not.toContain('Cordero & Lúpulo');
    expect(text).not.toContain('Miel del Valle');
    expect(text).not.toMatch(/CUIT|Razón social|@/i);
  });

  it('shows the stand card with the public exhibitor (spec: "Ficha de stand")', async () => {
    const { host, click } = await render();
    await click(host.querySelector('app-stand-map [data-code="A01"]')!);
    const card = plain(host.querySelector('.stand-card')?.textContent);
    expect(card).toContain('Stand A01');
    expect(card).toContain('Lanas del Limay');
    expect(card).toContain('Textil de autor');
  });

  it('locates a directory exhibitor on the plan', async () => {
    const { host, click } = await render();
    const locate = [...host.querySelectorAll('.directory button')].find((b) =>
      b.textContent?.includes('B05'),
    )!;
    await click(locate);
    expect(host.querySelector('app-stand-map [data-code="B05"]')?.classList).toContain('selected');
  });

  it('explains when the fair has no public map', async () => {
    const { host } = await render('no-existe');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No encontramos');
    expect(host.querySelector('a[href="/ferias"]')).not.toBeNull();
  });
});

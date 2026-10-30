import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { InMemoryPublicCatalogRepository } from './data/in-memory-public-catalog.repository';
import { PublicCatalogRepository } from './data/public-catalog.repository';
import { FairsPage } from './fairs.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function render() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: PublicCatalogRepository, useValue: new InMemoryPublicCatalogRepository() },
    ],
  });
  const fixture = TestBed.createComponent(FairsPage);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const names = () => [...host.querySelectorAll('.fair h2')].map((h) => plain(h.textContent));
  const type = async (value: string) => {
    const input = host.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  return { host, names, type };
}

describe('FairsPage (PUB-UI-05)', () => {
  it('lists the public fairs with place, dates and available stands', async () => {
    const { host, names } = await render();
    expect(plain(host.querySelector('h1')?.textContent)).toContain('del plano al stand');
    expect(names()).toEqual([
      'Patagonia Emprende 2026',
      'Feria del Litoral Artesanal',
      'Mendoza Sabores & Diseño',
    ]);
    const first = plain(host.querySelector('.fair')?.textContent);
    expect(first).toContain('Neuquén');
    expect(first).toContain('Espacio Duam');
    expect(first).toContain('12 de 40 stands disponibles');
    expect(first).toMatch(/nov/);
  });

  it('searches ignoring case and accents (spec: "Catálogo")', async () => {
    const { names, type } = await render();
    await type('neuquen');
    expect(names()).toEqual(['Patagonia Emprende 2026']);
  });

  it('shows an empty state when nothing matches', async () => {
    const { host, names, type } = await render();
    await type('zzz');
    expect(names()).toEqual([]);
    expect(host.textContent).toContain('No hay ferias que coincidan');
  });

  it('links to the map only when the fair has a public map', async () => {
    const { host } = await render();
    const links = [...host.querySelectorAll<HTMLAnchorElement>('a')].filter((a) =>
      a.textContent?.includes('Ver mapa y expositores'),
    );
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/ferias/patagonia-emprende-2026']);
  });
});

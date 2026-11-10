import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { InMemoryPublicCatalogRepository } from './data/in-memory-public-catalog.repository';
import { PublicCatalogRepository } from './data/public-catalog.repository';
import { ExploreStandsPage } from './explore-stands.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

async function render(repo: PublicCatalogRepository = new InMemoryPublicCatalogRepository()) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: PublicCatalogRepository, useValue: repo }],
  });
  const fixture = TestBed.createComponent(ExploreStandsPage);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const items = () => [...host.querySelectorAll<HTMLButtonElement>('.stand-list button')];
  const chips = (group: string) => [
    ...host.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`),
  ];
  const chip = (group: string, text: string) =>
    chips(group).find((b) => plain(b.textContent).startsWith(text))!;
  const click = async (el: Element) => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true })); // SVG has no .click() in jsdom
    await fixture.whenStable();
  };
  return { host, items, chips, chip, click };
}

describe('ExploreStandsPage (PUB-UI-04)', () => {
  it('shows the plan and the equivalent list of available stands', async () => {
    const { host, items } = await render();
    expect(plain(host.querySelector('h1')?.textContent)).toContain('Elegí tu stand');
    expect(host.querySelectorAll('app-stand-map g.stand')).toHaveLength(40);
    expect(items()).toHaveLength(12);
    expect(plain(host.querySelector('.stand-list-heading')?.textContent)).toBe(
      '12 stands disponibles',
    );
  });

  it('filters by sector: list only that sector, plan dims the rest (spec: "Filtros")', async () => {
    const { host, items, chip, click } = await render();
    await click(chip('Sector', 'Producción regional'));
    expect(chip('Sector', 'Producción regional').getAttribute('aria-pressed')).toBe('true');
    expect(items().length).toBeGreaterThan(0);
    expect(items().length).toBeLessThan(12);
    for (const b of items()) expect(b.textContent).toContain('Producción regional');
    expect(host.querySelector('app-stand-map [data-code="A01"]')?.classList).toContain('dimmed');
  });

  it('filters by maximum price with limits taken from the data', async () => {
    const { items, chips, chip, click } = await render();
    expect(chips('Precio').length).toBeGreaterThan(1);
    await click(chips('Precio')[1]); // cheapest limit
    expect(items().length).toBeGreaterThan(0);
    expect(items().length).toBeLessThan(12);
    await click(chip('Precio', 'Todos'));
    expect(items()).toHaveLength(12);
  });

  it('offers area limits taken from the data (every demo stand is 9 m²)', async () => {
    const { chips } = await render();
    expect(chips('Superficie').map((b) => plain(b.textContent))).toEqual(['Todas', 'desde 9 m²']);
  });

  it('selecting in the list selects on the plan and shows the detail (spec: "Lista equivalente")', async () => {
    const { host, items, click } = await render();
    const first = items()[0];
    const code = first.dataset['code']!;
    await click(first);
    expect(items()[0].getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector(`app-stand-map [data-code="${code}"]`)?.classList).toContain(
      'selected',
    );

    const detail = plain(host.querySelector('.stand-detail')?.textContent);
    expect(detail).toContain(`Stand ${code}`);
    expect(detail).toMatch(/\d+ m²/);
    expect(detail).toMatch(/\$\s?\d/);
    const reserve = host.querySelector<HTMLAnchorElement>('.stand-detail a')!;
    expect(plain(reserve.textContent)).toBe(`Reservar el stand ${code}`);
    const url = new URL(reserve.href);
    expect(url.pathname).toBe('/feriante/reservas/nueva');
    expect(url.searchParams.get('feria')).toBe('patagonia-emprende-2026');
    expect(url.searchParams.get('stand')).toBeTruthy();
  });

  it('shows a notice when there is no event on sale', async () => {
    const repo = new InMemoryPublicCatalogRepository();
    repo.listEvents = () => of([]);
    const { host } = await render(repo);
    expect(plain(host.textContent)).toContain('No hay ferias con venta de stands abierta');
  });

  it('shows a non-available stand picked on the plan without the reserve action', async () => {
    const { host, click } = await render();
    await click(host.querySelector('app-stand-map [data-code="D09"]')!);
    const detail = plain(host.querySelector('.stand-detail')?.textContent);
    expect(detail).toContain('Stand D09');
    expect(detail).toContain('Bloqueado');
    expect(host.querySelector('.stand-detail a, .stand-detail button')).toBeNull();
  });

  it('shows an error when the plan cannot load', async () => {
    const repo = new InMemoryPublicCatalogRepository();
    repo.getMap = () => throwError(() => new Error('boom'));
    const { host } = await render(repo);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar');
  });
});

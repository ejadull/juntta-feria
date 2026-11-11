import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { DocumentReviewRepository } from '../documents/data/document.repository';
import { InMemoryDocuments } from '../documents/data/in-memory-documents.repository';
import { CategoryRepository, type CategoryDto } from './data/category.repository';
import { ExhibitorRepository, type ExhibitorSummaryDto } from './data/exhibitor.repository';
import { InMemoryCategoryRepository } from './data/in-memory-category.repository';
import {
  DEMO_EXHIBITORS,
  InMemoryExhibitorRepository,
} from './data/in-memory-exhibitor.repository';
import { InMemoryInvitationRepository } from './data/in-memory-invitation.repository';
import { InvitationRepository } from './data/invitation.repository';
import { ExhibitorsPage } from './exhibitors.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** One rubro per distinct category of the demo exhibitors, with the ids the demo repo uses. */
const DEMO_CATEGORIES: readonly CategoryDto[] = [
  ...new Map(
    DEMO_EXHIBITORS.map((e) => [
      e.categoryId!,
      { id: e.categoryId!, name: e.category!, exhibitorCount: 1 },
    ]),
  ).values(),
];

async function render(repo: ExhibitorRepository = new InMemoryExhibitorRepository()) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ExhibitorRepository, useValue: repo },
      { provide: CategoryRepository, useValue: new InMemoryCategoryRepository(DEMO_CATEGORIES) },
      { provide: DocumentReviewRepository, useValue: new InMemoryDocuments().review },
      { provide: InvitationRepository, useValue: new InMemoryInvitationRepository() },
    ],
  });
  const fixture = TestBed.createComponent(ExhibitorsPage);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const items = () => [...host.querySelectorAll<HTMLButtonElement>('li button[data-id]')];
  const names = () => items().map((b) => plain(b.querySelector('.name')?.textContent));
  const type = async (value: string) => {
    const input = host.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const choose = async (label: string, value: string) => {
    const select = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  return { fixture, host, items, names, type, choose };
}

describe('ExhibitorsPage (P11, consulta)', () => {
  it('lists every exhibitor with the count', async () => {
    const { host, items } = await render();
    expect(plain(host.querySelector('h1')?.textContent)).toBe('Expositores');
    expect(items()).toHaveLength(12);
    expect(host.textContent).toContain('12 de 12');
    expect(host.textContent).not.toContain('Datos de demostración');
  });

  it('searches by trade name, legal name or category ignoring case and accents (spec: "Búsqueda")', async () => {
    const { names, type } = await render();
    await type('LANAS');
    expect(names()).toEqual(['Lanas del Limay']);
    await type('jaboneria');
    expect(names()).toEqual(['Jabonería Lafken']);
    await type('cosmetica');
    expect(names()).toEqual(['Verde Ruca', 'Jabonería Lafken']);
  });

  it('filters by documentation status, shown with icon and text (spec: "Filtro por documentación")', async () => {
    const { items, choose, host } = await render();
    await choose('Documentación', 'PENDING');
    expect(items().length).toBeGreaterThan(0);
    for (const b of items()) {
      const status = b.querySelector('.status')!;
      expect(plain(status.textContent)).toContain('Pendiente');
      expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
    expect(host.textContent).toMatch(/\d+ de 12/);
  });

  it('filters by category', async () => {
    const { names, choose } = await render();
    await choose('Rubro', 'demo-cat-Cerámica');
    expect(names()).toEqual(['Barro Cordillerano', 'Alfarería Collón Curá']);
  });

  it('shows the private record of the selected exhibitor (spec: "Ficha")', async () => {
    const { fixture, host, items } = await render();
    items()[0].click();
    await fixture.whenStable();
    const detail = plain(host.querySelector('app-exhibitor-detail')?.textContent);
    for (const text of [
      'Lanas del Limay',
      'Florencia Quiroga',
      'CUIT',
      '20-00000001-5',
      'Textil de autor',
      'Contacto público',
      'Documentación',
    ])
      expect(detail).toContain(text);
    expect(items()[0].getAttribute('aria-current')).toBe('true');
  });

  it('says when the tax id is missing and when nothing matches', async () => {
    const noTax: ExhibitorSummaryDto = {
      id: 'x',
      tradeName: 'Sin CUIT',
      legalName: 'Persona X',
      taxId: null,
      categoryId: 'demo-cat-Servicios',
      category: 'Servicios',
      description: '—',
      publicContactOptIn: false,
      documentsStatus: 'MISSING',
    };
    const repo = { list: () => of([noTax]) } as ExhibitorRepository;
    const { fixture, host, items, type } = await render(repo);
    items()[0].click();
    await fixture.whenStable();
    expect(host.querySelector('app-exhibitor-detail')?.textContent).toContain('Sin CUIT cargado');
    await type('zzz');
    expect(host.textContent).toContain('Ningún expositor coincide');
  });
});

describe('ExhibitorsPage empty and error states', () => {
  it('explains there are no exhibitors yet instead of an empty filter box', async () => {
    const { host } = await render({ list: () => of([]) } as ExhibitorRepository);
    expect(plain(host.querySelector('[data-testid="no-exhibitors"]')?.textContent)).toContain(
      'Todavía no hay expositores',
    );
    expect(host.querySelector('input[type="search"]')).toBeNull();
  });

  it('shows an alert when the list cannot be loaded', async () => {
    const { host } = await render({
      list: () => throwError(() => new Error('offline')),
    } as ExhibitorRepository);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar');
  });
});

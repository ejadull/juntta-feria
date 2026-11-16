import { TestBed } from '@angular/core/testing';
import { FileUploader } from '../documents/data/document.repository';
import { InMemoryFileUploader } from '../documents/data/in-memory-documents.repository';
import { CategoryRepository } from '../exhibitors/data/category.repository';
import { ExhibitorPhotosRepository } from './data/exhibitor-photos.repository';
import { InMemoryExhibitorPhotosRepository } from './data/in-memory-exhibitor-photos.repository';
import { InMemoryCategoryRepository } from '../exhibitors/data/in-memory-category.repository';
import { InMemoryExhibitorProfileRepository } from './data/in-memory-exhibitor-profile.repository';
import {
  ExhibitorProfileRepository,
  type ExhibitorProfileDto,
} from './data/exhibitor-profile.repository';
import { ExhibitorProfilePage } from './exhibitor-profile.page';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const CATEGORIES = [
  { id: 'c-textil', name: 'Textiles', exhibitorCount: 0 },
  { id: 'c-ceramica', name: 'Cerámica', exhibitorCount: 0 },
];

const profile: ExhibitorProfileDto = {
  id: 'p1',
  legalName: 'Lanas del Sur S.R.L.',
  tradeName: 'Lanas del Sur',
  taxId: '30712345671',
  categoryId: 'c-textil',
  category: 'Textiles',
  description: 'Hilados artesanales.',
  publicContactOptIn: false,
};

async function render(
  repo = new InMemoryExhibitorProfileRepository(),
  categories = new InMemoryCategoryRepository(CATEGORIES),
) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ExhibitorProfileRepository, useValue: repo },
      { provide: CategoryRepository, useValue: categories },
      { provide: ExhibitorPhotosRepository, useValue: new InMemoryExhibitorPhotosRepository() },
      { provide: FileUploader, useValue: new InMemoryFileUploader() },
    ],
  });
  const fixture = TestBed.createComponent(ExhibitorProfilePage);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const field = (label: string) =>
    [...host.querySelectorAll('label')]
      .find((l) => plain(l.querySelector('span')?.textContent).startsWith(label))!
      .querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        'input, select, textarea',
      )!;
  const fill = async (label: string, value: string) => {
    const input = field(label);
    input.value = value;
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
    await fixture.whenStable();
  };
  const save = async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  return { host, field, fill, save, repo };
}

describe('ExhibitorProfilePage (EXH-01/EXH-02, feriante)', () => {
  it('offers the organization rubros in a select, with none chosen on a new profile', async () => {
    const { field } = await render();
    const select = field('Rubro') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual([
      'Elegí un rubro',
      'Cerámica',
      'Textiles',
    ]);
    expect(select.value).toBe('');
  });

  it('loads the existing profile with its rubro selected', async () => {
    const { field } = await render(new InMemoryExhibitorProfileRepository(profile));
    expect((field('Nombre comercial') as HTMLInputElement).value).toBe('Lanas del Sur');
    expect((field('Rubro') as HTMLSelectElement).value).toBe('c-textil');
  });

  it('validates the required fields, with the first invalid one flagged', async () => {
    const { host, save, repo } = await render();
    await save();
    expect(host.textContent).toContain('Ingresá el nombre comercial.');
    expect(host.textContent).toContain('Ingresá la razón social.');
    expect(host.textContent).toContain('Elegí un rubro.');
    expect(host.querySelector('[aria-invalid="true"]')).not.toBeNull();
    expect(repo.saved).toHaveLength(0);
  });

  it('saves the whole profile with the chosen categoryId and confirms', async () => {
    const { host, fill, save, repo } = await render();
    await fill('Nombre comercial', ' Barro Sur ');
    await fill('Razón social', 'Barro Sur S.A.');
    await fill('Rubro', 'c-ceramica');
    await save();
    expect(repo.saved).toEqual([
      {
        tradeName: 'Barro Sur',
        legalName: 'Barro Sur S.A.',
        taxId: null,
        categoryId: 'c-ceramica',
        description: '',
        publicContactOptIn: false,
      },
    ]);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Guardamos tu perfil');
  });

  it('tells the exhibitor when the organization has no rubros yet', async () => {
    const { host } = await render(
      new InMemoryExhibitorProfileRepository(),
      new InMemoryCategoryRepository([]),
    );
    expect(host.querySelector('[data-testid="no-categories-hint"]')).not.toBeNull();
  });
});

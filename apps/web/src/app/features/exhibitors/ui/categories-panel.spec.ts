import { TestBed } from '@angular/core/testing';
import { CategoryRepository, type CategoryDto } from '../data/category.repository';
import { InMemoryCategoryRepository } from '../data/in-memory-category.repository';
import { CategoriesPanel } from './categories-panel';

const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const category = (patch: Partial<CategoryDto> = {}): CategoryDto => ({
  id: 'c1',
  name: 'Textiles',
  exhibitorCount: 0,
  ...patch,
});

async function render(seed: readonly CategoryDto[] = []) {
  TestBed.configureTestingModule({
    providers: [{ provide: CategoryRepository, useValue: new InMemoryCategoryRepository(seed) }],
  });
  const fixture = TestBed.createComponent(CategoriesPanel);
  const changed = vi.fn();
  fixture.componentInstance.changed.subscribe(changed);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;
  const click = async (label: string) => {
    [...host.querySelectorAll('button')]
      .find((b) => plain(b.textContent) === label || b.getAttribute('aria-label') === label)!
      .click();
    await fixture.whenStable();
  };
  const type = async (selector: string, value: string) => {
    const input = host.querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const submit = async (form: HTMLFormElement) => {
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
  };
  const rows = () =>
    [...host.querySelectorAll('[data-testid="category-row"]')].map((r) => plain(r.textContent));
  return { host, click, type, submit, rows, changed };
}

describe('CategoriesPanel (EXH-02)', () => {
  it('explains the empty state', async () => {
    const { host } = await render();
    expect(host.querySelector('[data-testid="no-categories"]')?.textContent).toContain(
      'Todavía no hay rubros',
    );
  });

  it('lists rubros with how many exhibitors use each', async () => {
    const { rows } = await render([
      category({ exhibitorCount: 2 }),
      category({ id: 'c2', name: 'Cerámica', exhibitorCount: 1 }),
    ]);
    expect(rows()[0]).toContain('Cerámica');
    expect(rows()[0]).toContain('1 expositor');
    expect(rows()[1]).toContain('2 expositores');
  });

  it('adds a rubro, clears the field and tells the page', async () => {
    const { host, type, submit, rows, changed } = await render();
    await type('input[type="text"]', '  Gastronomía ');
    await submit(host.querySelector('form')!);
    expect(rows()[0]).toContain('Gastronomía');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Agregamos el rubro');
    expect(host.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('validates the name and reports a repeated one', async () => {
    const { host, type, submit } = await render([category()]);
    await submit(host.querySelector('form')!);
    expect(host.querySelector('#category-add-error')?.textContent).toContain('Ingresá el nombre');
    await type('input[type="text"]', 'textiles');
    await submit(host.querySelector('form')!);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Ya tenés un rubro con ese nombre.',
    );
  });

  it('renames a rubro', async () => {
    const { host, click, type, submit, rows } = await render([category()]);
    await click('Renombrar Textiles');
    await type('input[aria-label="Nuevo nombre de Textiles"]', 'Indumentaria');
    await submit(host.querySelector('li form')!);
    expect(rows()[0]).toContain('Indumentaria');
  });

  it('confirms before deleting and explains when the rubro is in use', async () => {
    const { host, click, rows } = await render([
      category(),
      category({ id: 'c2', name: 'Cerámica', exhibitorCount: 3 }),
    ]);
    await click('Eliminar Textiles');
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain(
      '¿Eliminar el rubro Textiles?',
    );
    await click('Cancelar');
    expect(rows()).toHaveLength(2);
    await click('Eliminar Textiles');
    await click('Sí, eliminar');
    expect(rows()).toHaveLength(1);

    await click('Eliminar Cerámica');
    await click('Sí, eliminar');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'hay expositores con este rubro',
    );
    expect(rows()).toHaveLength(1);
  });
});

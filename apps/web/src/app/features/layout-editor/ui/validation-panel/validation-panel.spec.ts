import { TestBed } from '@angular/core/testing';
import type { ValidationIssue } from '../../domain/validation';
import { ValidationPanel } from './validation-panel';

const OVERLAP: ValidationIssue = {
  code: 'STAND_OVERLAP',
  severity: 'error',
  objectIds: ['a01', 'a02'],
  message: 'Los stands A01 y A02 se superponen.',
};
const NO_STANDS: ValidationIssue = {
  code: 'NO_STANDS',
  severity: 'error',
  objectIds: [],
  message: 'La versión no tiene stands.',
};

async function setup(
  issues: readonly ValidationIssue[],
  serverIssues: readonly ValidationIssue[] = [],
) {
  const fixture = TestBed.createComponent(ValidationPanel);
  fixture.componentRef.setInput('issues', issues);
  fixture.componentRef.setInput('serverIssues', serverIssues);
  const selected: string[] = [];
  fixture.componentInstance.select.subscribe((id) => selected.push(id));
  await fixture.whenStable();
  return { host: fixture.nativeElement as HTMLElement, selected };
}

describe('ValidationPanel', () => {
  it('says the version is ready when there are no issues', async () => {
    const { host } = await setup([]);
    expect(host.textContent).toContain('Sin errores');
  });

  it('lists each issue with an icon and its message', async () => {
    const { host } = await setup([OVERLAP, NO_STANDS]);
    const items = [...host.querySelectorAll('li')].map((li) =>
      li.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(items).toEqual([`⚠ ${OVERLAP.message}`, `⚠ ${NO_STANDS.message}`]);
    expect(host.textContent).toContain('2 errores');
  });

  it('selects the first affected object when an issue is clicked', async () => {
    const { host, selected } = await setup([OVERLAP]);
    (host.querySelector('li button') as HTMLButtonElement).click();
    expect(selected).toEqual(['a01']);
  });

  it('renders issues without objects as plain text, not as a button', async () => {
    const { host } = await setup([NO_STANDS]);
    expect(host.querySelector('li button')).toBeNull();
  });

  it('shows server rejections separately (spec: "Validación frontend no es autoridad")', async () => {
    const { host } = await setup([], [OVERLAP]);
    expect(host.textContent).toContain('Rechazado por el servidor');
    expect(host.textContent).toContain(OVERLAP.message);
  });
});

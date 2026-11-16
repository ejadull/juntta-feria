import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LEGAL_INFO } from './legal-info';
import { PrivacyPage } from './privacy.page';

async function render() {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(PrivacyPage);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('PrivacyPage', () => {
  it('renders the title, the last update and one h2 per numbered section', async () => {
    const host = await render();
    expect(host.querySelector('h1')?.textContent).toContain('Política de Privacidad');
    expect(host.textContent).toContain(LEGAL_INFO.lastUpdated);
    const headings = [...host.querySelectorAll('h2')].map((h) => h.textContent!.trim());
    expect(headings).toHaveLength(15);
    expect(headings[0]).toBe('1. Responsable del tratamiento');
    expect(headings[13]).toBe('14. Ley aplicable y jurisdicción');
  });

  it('states the real storage and the contact email from LEGAL_INFO', async () => {
    const host = await render();
    expect(host.textContent).toContain('juntta.theme');
    expect(host.textContent).toContain('No usamos herramientas de analítica');
    expect(host.querySelector(`a[href="mailto:${LEGAL_INFO.contactEmail}"]`)).not.toBeNull();
    expect(host.querySelector('a[href="https://www.argentina.gob.ar/aaip"]')).not.toBeNull();
  });

  it('links back home and to the terms; every TOC anchor has a target', async () => {
    const host = await render();
    expect(host.querySelector('a[href="/terminos"]')).not.toBeNull();
    expect(host.querySelector('a[href="/"]')?.textContent).toContain('Volver al inicio');
    const anchors = [...host.querySelectorAll('nav a')].map((a) => a.getAttribute('href')!.slice(1));
    for (const id of anchors) expect(host.querySelector(`#${id}`), id).not.toBeNull();
  });
});

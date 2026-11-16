import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LEGAL_INFO } from './legal-info';
import { TermsPage } from './terms.page';

async function render() {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(TermsPage);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('TermsPage', () => {
  it('renders the title, the last update and the platform sections', async () => {
    const host = await render();
    expect(host.querySelector('h1')?.textContent).toContain('Términos y Condiciones');
    expect(host.textContent).toContain(LEGAL_INFO.lastUpdated);
    const headings = [...host.querySelectorAll('h2')].map((h) => h.textContent!.trim());
    expect(headings).toHaveLength(18);
    expect(headings).toContain('5. Pagos');
    expect(headings).toContain('4. Reservas de stands');
  });

  it('says the organizer is the seller and that card data is not stored', async () => {
    const host = await render();
    const text = host.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('El organizador es el vendedor del stand');
    expect(text).toContain('Juntta no almacena datos de tu tarjeta');
  });

  it('links back home and to the privacy policy; every TOC anchor has a target', async () => {
    const host = await render();
    expect(host.querySelector('a[href="/privacidad"]')).not.toBeNull();
    expect(host.querySelector('a[href="/"]')?.textContent).toContain('Volver al inicio');
    const anchors = [...host.querySelectorAll('nav a')].map((a) => a.getAttribute('href')!.slice(1));
    for (const id of anchors) expect(host.querySelector(`#${id}`), id).not.toBeNull();
  });
});

import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';

async function open(url: string) {
  TestBed.configureTestingModule({
    providers: [provideRouter(routes, withComponentInputBinding())],
  });
  const harness = await RouterTestingHarness.create(url);
  await harness.fixture.whenStable();
  const host = harness.fixture.nativeElement as HTMLElement;
  const current = () =>
    [...host.querySelectorAll('nav a[aria-current="page"]')].map((a) => a.textContent!.trim());
  return { harness, host, current, router: TestBed.inject(Router) };
}

describe('organizer routes (ORG-01)', () => {
  it('redirects the root to the Panel (spec: "Raíz")', async () => {
    const { router, current } = await open('/');
    expect(router.url).toBe('/organizador/panel');
    expect(current()).toEqual(['Panel']);
  });

  it('marks the active section with aria-current (spec: "Sección activa")', async () => {
    const { current, host } = await open('/organizador/expositores');
    expect(current()).toEqual(['Expositores']);
    expect(host.querySelector('main h1')?.textContent).toContain('Expositores');
    expect(TestBed.inject(Title).getTitle()).toBe('Expositores · Juntta Feria');
  });

  it('keeps "Editor de plano" active for any layout version, inside the shell', async () => {
    const { current, host } = await open('/organizador/layouts/demo-v1/editor');
    expect(current()).toEqual(['Editor de plano']);
    expect(host.querySelector('main app-layout-editor-page')).not.toBeNull();
  });

  it('shows the reservations placeholder', async () => {
    const { current } = await open('/organizador/reservas');
    expect(current()).toEqual(['Reservas y cobros']);
  });

  it('shows "Página no encontrada" with a link to the Panel (spec: "Ruta inexistente")', async () => {
    const { host } = await open('/organizador/no-existe');
    expect(host.textContent).toContain('Página no encontrada');
    expect(host.querySelector('main a[href="/organizador/panel"]')).not.toBeNull();

    TestBed.resetTestingModule();
    const outside = await open('/cualquier-cosa');
    expect(outside.host.textContent).toContain('Página no encontrada');
  });

  it('labels the navigation and the demo data', async () => {
    const { host } = await open('/organizador/panel');
    expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe('Secciones del organizador');
    expect(host.textContent).toContain('Demo de UX');
  });
});

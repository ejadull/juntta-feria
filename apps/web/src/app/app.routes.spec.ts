import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';

async function open(url: string) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
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
    const { current, host } = await open('/organizador/reservas');
    expect(current()).toEqual(['Reservas y cobros']);
    expect(host.querySelector('main h1')?.textContent).toContain('Reservas y cobros');
  });

  it('links Mercado Pago through its return page and keeps the section active (P12, PAY-07)', async () => {
    const { current, host, harness, router } = await open('/organizador/mercado-pago');
    expect(current()).toEqual(['Mercado Pago']);
    expect(TestBed.inject(Title).getTitle()).toBe('Mercado Pago · Juntta Feria');
    expect(host.querySelector('main .status')?.textContent).toContain('Sin vincular');

    await harness.navigateByUrl(
      '/organizador/mercado-pago/vincular?code=demo-code&state=demo-state',
    );
    await harness.fixture.whenStable();
    expect(router.url).toBe('/organizador/mercado-pago');
    expect(current()).toEqual(['Mercado Pago']);
    expect(host.querySelector('main .status')?.textContent).toContain('Vinculada');
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

describe('areas and "Ver como" (PUB-UI-01)', () => {
  const pressed = (host: HTMLElement) =>
    [...host.querySelectorAll('[aria-label^="Ver como"] button[aria-pressed="true"]')].map((b) =>
      b.textContent!.trim(),
    );

  it('shows the feriante area with its navigation (spec: "Ver como")', async () => {
    const { host, current } = await open('/feriante/explorar');
    expect(pressed(host)).toEqual(['Feriante']);
    const items = [...host.querySelectorAll('nav a')].map((a) => a.textContent!.trim());
    expect(items).toEqual(['Explorar stands', 'Reserva y pago', 'Mis reservas']);
    expect(current()).toEqual(['Explorar stands']);
    expect(host.querySelector('main h1')?.textContent).toContain('Elegí tu stand');
  });

  it('switches area from the demo selector', async () => {
    const { harness, host, router } = await open('/organizador/panel');
    const visitor = [
      ...host.querySelectorAll<HTMLButtonElement>('[aria-label^="Ver como"] button'),
    ].find((b) => b.textContent!.includes('Visitante'))!;
    visitor.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/ferias');
    expect(pressed(host)).toEqual(['Visitante']);
  });

  it('keeps "Ferias" and "Mapa y expositores" apart in the visitor navigation', async () => {
    const list = await open('/ferias');
    expect(list.current()).toEqual(['Ferias']);
    TestBed.resetTestingModule();
    const map = await open('/ferias/patagonia-emprende-2026');
    expect(map.current()).toEqual(['Mapa y expositores']);
  });

  it('shows reservation placeholders without simulated data (spec: "Marcadores de reserva")', async () => {
    for (const path of ['/feriante/reserva', '/feriante/reservas']) {
      TestBed.resetTestingModule();
      const { host } = await open(path);
      expect(host.querySelector('main h1')?.textContent?.trim()).not.toBe('');
      expect(host.querySelector('main')?.textContent).toContain('RES-01');
      expect(host.querySelector('main')?.textContent).not.toMatch(/\$\s?\d/);
    }
  });
});

describe('API status in the shell (FND-05)', () => {
  const status = (host: HTMLElement) =>
    host.querySelector('[data-testid="api-status"]')?.textContent?.replace(/\s+/g, ' ').trim();

  it('shows the API as connected when liveness answers through the app origin', async () => {
    const { harness, host } = await open('/organizador/panel');
    expect(status(host)).toBe('API: verificando…');
    TestBed.inject(HttpTestingController).expectOne('/api/v1/health/live').flush({ status: 'ok' });
    await harness.fixture.whenStable();
    expect(status(host)).toBe('API: conectada');
    expect(host.querySelector('[data-testid="api-status"]')?.getAttribute('role')).toBe('status');
  });

  it('shows the API as unreachable on failure, without blocking the demo', async () => {
    const { harness, host } = await open('/ferias');
    TestBed.inject(HttpTestingController)
      .expectOne('/api/v1/health/live')
      .error(new ProgressEvent('error'));
    await harness.fixture.whenStable();
    expect(status(host)).toBe('API: sin conexión');
    expect(host.querySelector('main h1')).not.toBeNull();
  });
});

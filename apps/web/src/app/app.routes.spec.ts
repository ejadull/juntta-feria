import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { signedInAs } from './shared/auth/testing';

async function open(url: string, { signedIn = false }: { signedIn?: boolean } = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      provideHttpClient(),
      provideHttpClientTesting(),
      ...(signedIn ? [signedInAs()] : []),
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
    const { host, current } = await open('/feriante/explorar', { signedIn: true });
    expect(pressed(host)).toEqual(['Feriante']);
    const items = [...host.querySelectorAll('nav a')].map((a) => a.textContent!.trim());
    expect(items).toEqual(['Explorar stands', 'Mis reservas', 'Suscripción']);
    expect(current()).toEqual(['Explorar stands']);
    expect(host.querySelector('main h1')?.textContent).toContain('Elegí tu stand');
  });

  it('sends anonymous visitors to sign in and remembers where they were going (P01)', async () => {
    const { router, host } = await open('/feriante/reservas');
    expect(router.url).toBe('/ingresar?volver=%2Fferiante%2Freservas');
    expect(host.querySelector('main h1')?.textContent).toContain('Entrá a tu cuenta');
    expect(pressed(host)).toEqual(['Feriante']);
  });

  it('keeps the visitor pages public', async () => {
    const { router } = await open('/ferias');
    expect(router.url).toBe('/ferias');
  });

  it('opens the subscription screen, the back_url of the preapproval (EXH-05)', async () => {
    const { current, harness, host } = await open('/feriante/suscripcion', { signedIn: true });
    expect(current()).toEqual(['Suscripción']);
    // The page reads on a timer.
    const http = TestBed.inject(HttpTestingController);
    await vi.waitFor(() => http.expectOne('/api/v1/me/subscription').flush({ status: 'NONE' }));
    await harness.fixture.whenStable();
    expect(host.querySelector('main h1')?.textContent).toContain('Suscripción');
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

  it('opens the checkout returns of Mercado Pago back_urls, and only those (P19, PAY-04)', async () => {
    const { host, current, harness } = await open('/feriante/reservas/r-1/pago/rechazado', {
      signedIn: true,
    });
    expect(TestBed.inject(Title).getTitle()).toBe('Pago de tu reserva · Juntta Feria');
    expect(current()).toEqual(['Mis reservas']);
    const http = TestBed.inject(HttpTestingController);
    await vi.waitFor(() =>
      http.expectOne('/api/v1/reservations/r-1').flush({
        id: 'r-1',
        status: 'HELD',
        holdExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        amount: { currency: 'ARS', valueCents: 1_000_000 },
        stand: { id: 's', code: 'S2', areaM2: 9 },
        eventId: 'e',
      }),
    );
    await harness.fixture.whenStable();
    expect(host.querySelector('main h1')?.textContent).toContain('El pago fue rechazado');

    TestBed.resetTestingModule();
    const other = await open('/feriante/reservas/r-1/pago/cualquiera', { signedIn: true });
    expect(other.host.textContent).toContain('Página no encontrada');
  });

  it('opens the reservation summary (P18) and the exhibitor list inside the area', async () => {
    const reserve = await open('/feriante/reservas/nueva?stand=s1&feria=f', { signedIn: true });
    expect(TestBed.inject(Title).getTitle()).toBe('Reserva y pago · Juntta Feria');
    expect(reserve.current()).toEqual(['Mis reservas']);
    TestBed.resetTestingModule();
    const list = await open('/feriante/reservas', { signedIn: true });
    expect(list.host.querySelector('main h1')?.textContent).toContain('Mis reservas');
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

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { signedInAs } from './shared/auth/testing';
import type { MembershipDto, MembershipRole } from './shared/auth/session.store';

const membership = (tenantId: string, role: MembershipRole): MembershipDto => ({
  tenantId,
  tenantSlug: tenantId,
  tenantName: `Org ${tenantId}`,
  role,
});

/** `as`: the signed-in user's role (or memberships); omitted = anonymous. */
async function open(
  url: string,
  { as, settle = true }: { as?: MembershipRole | readonly MembershipDto[]; settle?: boolean } = {},
) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      provideHttpClient(),
      provideHttpClientTesting(),
      ...(as ? [signedInAs(as)] : []),
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  // Pages that load on init (HTTP) keep the app unstable until the test answers the request.
  if (settle) await harness.fixture.whenStable();
  const host = harness.fixture.nativeElement as HTMLElement;
  const current = () =>
    [...host.querySelectorAll('nav a[aria-current="page"]')].map((a) => a.textContent!.trim());
  return { harness, host, current, router: TestBed.inject(Router) };
}

describe('organizer routes (ORG-01)', () => {
  it('redirects the root to the Panel for staff (spec: "Raíz")', async () => {
    const { router, current } = await open('/', { as: 'ADMIN' });
    expect(router.url).toBe('/organizador/panel');
    expect(current()).toEqual(['Panel']);
  });

  it('marks the active section with aria-current (spec: "Sección activa")', async () => {
    const { current, host } = await open('/organizador/expositores', { as: 'OWNER' });
    expect(current()).toEqual(['Expositores']);
    expect(host.querySelector('main h1')?.textContent).toContain('Expositores');
    expect(TestBed.inject(Title).getTitle()).toBe('Expositores · Juntta Feria');
  });

  it('keeps "Editor de plano" active for any layout version, inside the shell', async () => {
    const { current, host, harness } = await open('/organizador/layouts/lv-1/editor', {
      as: 'OWNER',
      settle: false,
    });
    TestBed.inject(HttpTestingController).expectOne('/api/v1/layout-versions/lv-1').flush({
      id: 'lv-1',
      templateId: 't',
      version: 1,
      status: 'PUBLISHED',
      widthM: 20,
      heightM: 10,
      objects: [],
    });
    await harness.fixture.whenStable();
    expect(current()).toEqual(['Editor de plano']);
    expect(host.querySelector('main app-layout-editor-page')).not.toBeNull();
  });

  it('opens the layout of the current event from "Editor de plano"', async () => {
    const { router } = await open('/organizador/plano', { as: 'OWNER', settle: false });
    TestBed.inject(HttpTestingController)
      .expectOne('/api/v1/events')
      .flush([
        {
          id: 'e1',
          name: 'Feria',
          status: 'PUBLISHED',
          startsAt: '2026-11-20T13:00:00Z',
          layoutVersionId: 'lv-9',
        },
      ]);
    // The editor then asks for that version; the redirect is what this test cares about.
    await vi.waitFor(() =>
      TestBed.inject(HttpTestingController).expectOne('/api/v1/layout-versions/lv-9'),
    );
    expect(router.url).toBe('/organizador/layouts/lv-9/editor');
  });

  it('opens "Reservas y cobros" with the reservations of the API (RES-01)', async () => {
    const { current, host, harness } = await open('/organizador/reservas', { as: 'OWNER' });
    expect(current()).toEqual(['Reservas y cobros']);
    expect(TestBed.inject(Title).getTitle()).toBe('Reservas y cobros · Juntta Feria');
    const http = TestBed.inject(HttpTestingController);
    http
      .expectOne('/api/v1/events')
      .flush([
        { id: 'e1', name: 'Feria Sandbox', status: 'PUBLISHED', startsAt: '2026-11-20T13:00:00Z' },
      ]);
    http.expectOne('/api/v1/payment-incidents').flush([]);
    await harness.fixture.whenStable();
    http.expectOne((r) => r.url === '/api/v1/reservations').flush([]);
    await harness.fixture.whenStable();
    expect(host.querySelector('main h1')?.textContent).toContain('Reservas y cobros');
    expect(host.textContent).toContain('Todavía no hay reservas en este evento');
  });

  it('links Mercado Pago through its return page and keeps the section active (P12, PAY-07)', async () => {
    const { current, host, harness, router } = await open('/organizador/mercado-pago', {
      as: 'OWNER',
    });
    expect(current()).toEqual(['Mercado Pago']);
    expect(TestBed.inject(Title).getTitle()).toBe('Mercado Pago · Juntta Feria');
    const http = TestBed.inject(HttpTestingController);
    const unlinked = {
      status: 'NOT_LINKED',
      environment: 'sandbox',
      sellerId: null,
      liveMode: null,
      expiresAt: null,
      linkedAt: null,
    };
    http.expectOne('/api/v1/payment-account').flush(unlinked);
    await harness.fixture.whenStable();
    expect(host.querySelector('main .status')?.textContent).toContain('Sin vincular');

    await harness.navigateByUrl('/organizador/mercado-pago/vincular?code=c&state=s');
    const link = http.expectOne('/api/v1/payment-account/link');
    expect(link.request.body).toEqual({ code: 'c', state: 's' });
    link.flush({ ...unlinked, status: 'LINKED', sellerId: '123' });
    await harness.fixture.whenStable();
    http.expectOne('/api/v1/payment-account').flush({ ...unlinked, status: 'LINKED' });
    await harness.fixture.whenStable();
    expect(router.url).toBe('/organizador/mercado-pago');
    expect(current()).toEqual(['Mercado Pago']);
    expect(host.querySelector('main .status')?.textContent).toContain('Vinculada');
  });

  it('shows "Página no encontrada" with a link to the Panel (spec: "Ruta inexistente")', async () => {
    const { host } = await open('/organizador/no-existe', { as: 'OWNER' });
    expect(host.textContent).toContain('Página no encontrada');
    expect(host.querySelector('main a[href="/organizador/panel"]')).not.toBeNull();

    TestBed.resetTestingModule();
    const outside = await open('/cualquier-cosa');
    expect(outside.host.textContent).toContain('Página no encontrada');
  });

  it('labels the navigation and shows the organization name, with no demo data', async () => {
    const { host } = await open('/organizador/panel', { as: 'OWNER' });
    expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe('Secciones del organizador');
    expect(host.textContent).toContain('Entorno de prueba');
    expect(host.textContent).toContain('Organización');
    expect(host.textContent).not.toContain('Demo de UX');
    expect(host.textContent).not.toContain('Patagonia');
  });
});

describe('areas by role (PUB-UI-01)', () => {
  const navItems = (host: HTMLElement) =>
    [...host.querySelectorAll('nav a')].map((a) => a.textContent!.trim());

  it('shows the feriante area with its navigation to an exhibitor', async () => {
    const { host, current } = await open('/feriante/explorar', { as: 'EXHIBITOR' });
    expect(host.textContent).not.toContain('Ver como');
    expect(navItems(host)).toEqual(['Explorar stands', 'Mis reservas', 'Suscripción']);
    expect(current()).toEqual(['Explorar stands']);
    expect(host.querySelector('main h1')?.textContent).toContain('Elegí tu stand');
  });

  it('sends anonymous visitors to sign in and remembers where they were going (P01)', async () => {
    const { router, host } = await open('/feriante/reservas');
    expect(router.url).toBe('/ingresar?volver=%2Fferiante%2Freservas');
    expect(host.querySelector('main h1')?.textContent).toContain('Entrá a tu cuenta');
    expect(navItems(host)).toEqual(['Ferias']);
  });

  it('switches to the alternative "Corporativo" palette from the shell', async () => {
    const { host, harness } = await open('/ferias');
    const select = host.querySelector<HTMLSelectElement>('app-theme-picker select')!;
    const choose = (value: string) => {
      select.value = value;
      select.dispatchEvent(new Event('change'));
    };
    expect(select.value).toBe('grafito'); // default (paleta 2)

    choose('corporativo');
    await harness.fixture.whenStable();
    expect(document.documentElement.dataset['theme']).toBe('corporativo');

    choose('clasico');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    localStorage.removeItem('juntta.theme');
  });

  it('keeps the visitor pages public', async () => {
    const { router } = await open('/ferias');
    expect(router.url).toBe('/ferias');
  });

  it('opens the subscription screen, the back_url of the preapproval (EXH-05)', async () => {
    const { current, harness, host } = await open('/feriante/suscripcion', { as: 'EXHIBITOR' });
    expect(current()).toEqual(['Suscripción']);
    // The page reads on a timer.
    const http = TestBed.inject(HttpTestingController);
    await vi.waitFor(() => http.expectOne('/api/v1/me/subscription').flush({ status: 'NONE' }));
    await harness.fixture.whenStable();
    expect(host.querySelector('main h1')?.textContent).toContain('Suscripción');
  });

  it('shows only the organizer navigation to staff, with no "Ver como"', async () => {
    const { host } = await open('/organizador/panel', { as: 'OPERATOR' });
    expect(navItems(host)).toEqual([
      'Panel',
      'Editor de plano',
      'Reservas y cobros',
      'Expositores',
      'Mercado Pago',
    ]);
    expect(host.textContent).not.toContain('Ver como');
    expect(host.querySelector('[data-testid="session-area"]')?.textContent).toContain(
      'Organizador',
    );
  });

  it('shows only the visitor navigation, and "Ingresar", to anonymous users', async () => {
    const { host } = await open('/ferias');
    expect(navItems(host)).toEqual(['Ferias']);
    expect(host.querySelector('aside a[href="/ingresar"]')?.textContent).toContain('Ingresar');
  });

  it('sends an exhibitor away from the organizer area to the exhibitor home', async () => {
    const { router, current } = await open('/organizador/panel', { as: 'EXHIBITOR' });
    expect(router.url).toBe('/feriante/explorar');
    expect(current()).toEqual(['Explorar stands']);
  });

  it('sends staff away from the exhibitor area to the Panel', async () => {
    const { router } = await open('/feriante/reservas', { as: 'OWNER' });
    expect(router.url).toBe('/organizador/panel');
  });

  it('sends anonymous users from the organizer area to sign in', async () => {
    const { router } = await open('/organizador/expositores');
    expect(router.url).toBe('/ingresar?volver=%2Forganizador%2Fexpositores');
  });

  it('redirects the root by area', async () => {
    expect((await open('/', { as: 'EXHIBITOR' })).router.url).toBe('/feriante/explorar');
    TestBed.resetTestingModule();
    expect((await open('/')).router.url).toBe('/ferias');
  });

  it('switches area, landing on its home, when the chosen organization has another role', async () => {
    const { harness, host, router } = await open('/organizador/panel', {
      as: [membership('a', 'OWNER'), membership('b', 'EXHIBITOR')],
    });
    const select = host.querySelector<HTMLSelectElement>('select.org-select')!;
    select.value = 'b';
    select.dispatchEvent(new Event('change'));
    await harness.fixture.whenStable();
    expect(router.url).toBe('/feriante/explorar');
    expect(navItems(host)).toEqual(['Explorar stands', 'Mis reservas', 'Suscripción']);
  });

  it('keeps "Ferias" active on the list and on a fair map', async () => {
    const list = await open('/ferias');
    expect(list.current()).toEqual(['Ferias']);
    TestBed.resetTestingModule();
    const map = await open('/ferias/patagonia-emprende-2026');
    expect(map.current()).toEqual(['Ferias']);
  });

  it('opens the checkout returns of Mercado Pago back_urls, and only those (P19, PAY-04)', async () => {
    const { host, current, harness } = await open('/feriante/reservas/r-1/pago/rechazado', {
      as: 'EXHIBITOR',
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
    const other = await open('/feriante/reservas/r-1/pago/cualquiera', { as: 'EXHIBITOR' });
    expect(other.host.textContent).toContain('Página no encontrada');
  });

  it('opens the reservation summary (P18) and the exhibitor list inside the area', async () => {
    const reserve = await open('/feriante/reservas/nueva?stand=s1&feria=f', { as: 'EXHIBITOR' });
    expect(TestBed.inject(Title).getTitle()).toBe('Reserva y pago · Juntta Feria');
    expect(reserve.current()).toEqual(['Mis reservas']);
    TestBed.resetTestingModule();
    const list = await open('/feriante/reservas', { as: 'EXHIBITOR' });
    expect(list.host.querySelector('main h1')?.textContent).toContain('Mis reservas');
  });
});

describe('API status in the shell (FND-05)', () => {
  const status = (host: HTMLElement) =>
    host.querySelector('[data-testid="api-status"]')?.textContent?.replace(/\s+/g, ' ').trim();

  it('shows the API as connected when liveness answers through the app origin', async () => {
    const { harness, host } = await open('/organizador/panel', { as: 'OWNER' });
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

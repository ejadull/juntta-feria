import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type RouterStateSnapshot } from '@angular/router';
import { areaGuard, authGuard, safeReturnUrl } from './auth.guard';
import { signedInAs } from './testing';

const run = (url: string) =>
  TestBed.runInInjectionContext(() => authGuard({} as never, { url } as RouterStateSnapshot));

describe('authGuard (P01)', () => {
  it('lets a signed-in user through', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), signedInAs()] });
    expect(run('/feriante/reservas')).toBe(true);
  });

  it('redirects an anonymous visitor to sign in, remembering the destination', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const result = run('/feriante/reservas/nueva?stand=s1');
    expect(TestBed.inject(Router).serializeUrl(result as never)).toBe(
      '/ingresar?volver=%2Fferiante%2Freservas%2Fnueva%3Fstand%3Ds1',
    );
  });
});

describe('areaGuard', () => {
  const runArea = (area: 'organizador' | 'feriante', url: string) =>
    TestBed.runInInjectionContext(() =>
      areaGuard(area)({} as never, { url } as RouterStateSnapshot),
    );
  const serialize = (result: unknown) => TestBed.inject(Router).serializeUrl(result as never);

  it('sends anonymous users to sign in, remembering the destination', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    expect(serialize(runArea('organizador', '/organizador/panel'))).toBe(
      '/ingresar?volver=%2Forganizador%2Fpanel',
    );
  });

  it('lets each role into its own area', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), signedInAs('ADMIN')] });
    expect(runArea('organizador', '/organizador/panel')).toBe(true);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([]), signedInAs('EXHIBITOR')] });
    expect(runArea('feriante', '/feriante/reservas')).toBe(true);
  });

  it('sends an exhibitor away from the organizer area to the exhibitor home', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), signedInAs('EXHIBITOR')] });
    expect(serialize(runArea('organizador', '/organizador/panel'))).toBe('/feriante/explorar');
  });

  it('sends staff away from the exhibitor area to the panel', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), signedInAs('OPERATOR')] });
    expect(serialize(runArea('feriante', '/feriante/reservas'))).toBe('/organizador/panel');
  });

  it('sends a user without memberships to the public fairs', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), signedInAs([])] });
    expect(serialize(runArea('organizador', '/organizador/panel'))).toBe('/ferias');
  });
});

describe('safeReturnUrl', () => {
  it('only accepts paths inside the app', () => {
    expect(safeReturnUrl('/feriante/reservas')).toBe('/feriante/reservas');
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', '', null, undefined])
      expect(safeReturnUrl(bad)).toBe('/feriante/explorar');
  });

  it('falls back to the given home when the path is not accepted', () => {
    expect(safeReturnUrl('https://evil.test', '/organizador/panel')).toBe('/organizador/panel');
    expect(safeReturnUrl('/feriante/reservas', '/organizador/panel')).toBe('/feriante/reservas');
  });
});

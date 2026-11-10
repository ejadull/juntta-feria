import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type RouterStateSnapshot } from '@angular/router';
import { authGuard, safeReturnUrl } from './auth.guard';
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

describe('safeReturnUrl', () => {
  it('only accepts paths inside the app', () => {
    expect(safeReturnUrl('/feriante/reservas')).toBe('/feriante/reservas');
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', '', null, undefined])
      expect(safeReturnUrl(bad)).toBe('/feriante/explorar');
  });
});

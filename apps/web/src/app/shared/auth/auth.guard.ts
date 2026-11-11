import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AREA_HOME, type AreaId } from './area';
import { SessionStore } from './session.store';

/** Sends anonymous visitors to sign in and brings them back to where they were going. */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(SessionStore).user()) return true;
  return inject(Router).createUrlTree(['/ingresar'], { queryParams: { volver: state.url } });
};

/**
 * Keeps each area for its own role: anonymous users go to sign in (and come back), signed-in users
 * with another role go to their own area. The session is already restored when routing starts
 * (app initializer), so a reload does not bounce anyone.
 */
export const areaGuard =
  (area: AreaId): CanActivateFn =>
  (route, state) => {
    const session = inject(SessionStore);
    if (!session.user()) return authGuard(route, state);
    if (session.area() === area) return true;
    return inject(Router).createUrlTree([AREA_HOME[session.area()]]);
  };

/** Only same-app paths: `volver` comes from the URL, so an absolute URL would be an open redirect. */
export function safeReturnUrl(value: string | null | undefined): string {
  const internal =
    !!value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\');
  return internal ? value : '/feriante/explorar';
}

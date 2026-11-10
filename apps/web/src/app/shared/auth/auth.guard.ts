import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { SessionStore } from './session.store';

/** Sends anonymous visitors to sign in and brings them back to where they were going. */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(SessionStore).user()) return true;
  return inject(Router).createUrlTree(['/ingresar'], { queryParams: { volver: state.url } });
};

/** Only same-app paths: `volver` comes from the URL, so an absolute URL would be an open redirect. */
export function safeReturnUrl(value: string | null | undefined): string {
  const internal =
    !!value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\');
  return internal ? value : '/feriante/explorar';
}

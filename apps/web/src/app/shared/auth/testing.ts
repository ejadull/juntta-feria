import { signal, type Provider } from '@angular/core';
import { of } from 'rxjs';
import { SessionStore } from './session.store';

/** A signed-in `SessionStore` for component and route specs (the real one talks to the API). */
export function signedInAs(email = 'feriante@example.test'): Provider {
  const fake = {
    user: signal({ id: 'user-1', email }),
    memberships: signal([]),
    tenantId: signal<string | null>('tenant-1'),
    accessToken: () => 'token',
    selectTenant: () => undefined,
    refresh: () => of(true),
    logout: () => of(undefined),
    restore: () => Promise.resolve(),
  };
  return { provide: SessionStore, useValue: fake };
}

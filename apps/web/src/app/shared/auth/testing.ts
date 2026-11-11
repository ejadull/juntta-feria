import { computed, signal, type Provider } from '@angular/core';
import { of } from 'rxjs';
import { areaFor } from './area';
import { SessionStore, type MembershipDto, type MembershipRole } from './session.store';

/**
 * A signed-in `SessionStore` for component and route specs (the real one talks to the API).
 * Pass a role for a single membership, or a list of memberships (the first one is active).
 */
export function signedInAs(
  roleOrMemberships: MembershipRole | readonly MembershipDto[] = 'EXHIBITOR',
  email = 'feriante@example.test',
): Provider {
  const list: readonly MembershipDto[] =
    typeof roleOrMemberships === 'string'
      ? [
          {
            tenantId: 'tenant-1',
            tenantSlug: 'org',
            tenantName: 'Organización',
            role: roleOrMemberships,
          },
        ]
      : roleOrMemberships;
  const user = signal({ id: 'user-1', email });
  const memberships = signal(list);
  const chosen = signal<string | null>(list[0]?.tenantId ?? null);
  const fake = {
    user,
    memberships,
    tenantId: chosen.asReadonly(),
    role: computed(() => memberships().find((m) => m.tenantId === chosen())?.role ?? null),
    canAdminister: computed(() => {
      const role = memberships().find((m) => m.tenantId === chosen())?.role;
      return role === 'OWNER' || role === 'ADMIN';
    }),
    area: computed(() => areaFor(true, memberships(), chosen())),
    accessToken: () => 'token',
    selectTenant: (id: string) => chosen.set(id),
    refresh: () => of(true),
    logout: () => of(undefined),
    restore: () => Promise.resolve(),
  };
  return { provide: SessionStore, useValue: fake };
}

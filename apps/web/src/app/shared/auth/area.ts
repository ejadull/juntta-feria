import type { MembershipDto, MembershipRole } from './session.store';

/** Which part of the app the current user belongs to, decided by their role in the active organization. */
export type AreaId = 'organizador' | 'feriante' | 'visitante';

export const AREA_HOME: Readonly<Record<AreaId, string>> = {
  organizador: '/organizador/panel',
  feriante: '/feriante/explorar',
  visitante: '/ferias',
};

const areaOfRole = (role: MembershipRole): AreaId =>
  role === 'EXHIBITOR' ? 'feriante' : 'organizador';

/** Anonymous users, and signed-in users without a membership in the active organization, are visitors. */
export function areaFor(
  signedIn: boolean,
  memberships: readonly MembershipDto[],
  tenantId: string | null,
): AreaId {
  if (!signedIn) return 'visitante';
  const active = memberships.find((m) => m.tenantId === tenantId);
  return active ? areaOfRole(active.role) : 'visitante';
}

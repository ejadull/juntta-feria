import { areaFor } from './area';
import type { MembershipDto, MembershipRole } from './session.store';

const membership = (tenantId: string, role: MembershipRole): MembershipDto => ({
  tenantId,
  tenantSlug: tenantId,
  tenantName: tenantId,
  role,
});

describe('areaFor', () => {
  it.each(['OWNER', 'ADMIN', 'OPERATOR'] as const)('maps %s to the organizer area', (role) => {
    expect(areaFor(true, [membership('t1', role)], 't1')).toBe('organizador');
  });

  it('maps EXHIBITOR to the exhibitor area', () => {
    expect(areaFor(true, [membership('t1', 'EXHIBITOR')], 't1')).toBe('feriante');
  });

  it('follows the active organization when the user has several', () => {
    const all = [membership('a', 'OWNER'), membership('b', 'EXHIBITOR')];
    expect(areaFor(true, all, 'a')).toBe('organizador');
    expect(areaFor(true, all, 'b')).toBe('feriante');
  });

  it('treats anonymous users and users without memberships as visitors', () => {
    expect(areaFor(false, [], null)).toBe('visitante');
    expect(areaFor(true, [], null)).toBe('visitante');
  });
});

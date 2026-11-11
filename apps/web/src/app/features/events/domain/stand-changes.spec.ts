import type { StandDto } from '../data/event-inventory.repository';
import { diffStand, draftOf, groupChanges } from './stand-changes';

const stand = (patch: Partial<StandDto> = {}): StandDto => ({
  id: 'st1',
  layoutObjectId: 'o1',
  code: 'S1',
  sectorId: null,
  status: 'AVAILABLE',
  priceCents: 150_000,
  hasPrice: true,
  currency: 'ARS',
  ...patch,
});

describe('diffStand', () => {
  it('is unchanged when the draft is what the stand has', () => {
    const s = stand();
    expect(diffStand(s, draftOf(s, '1500'))).toEqual({ kind: 'unchanged' });
  });

  it('sends the price in cents', () => {
    const s = stand();
    expect(diffStand(s, { ...draftOf(s, '1500'), price: '1.750,50' })).toEqual({
      kind: 'changed',
      delta: { priceCents: 175_050 },
    });
  });

  it('sends a first price for a stand that had none', () => {
    const s = stand({ hasPrice: false, priceCents: 0 });
    expect(diffStand(s, { ...draftOf(s, ''), price: '0' })).toEqual({
      kind: 'changed',
      delta: { priceCents: 0 },
    });
  });

  it('leaves a stand without price untouched while the input is empty', () => {
    const s = stand({ hasPrice: false, priceCents: 0 });
    expect(diffStand(s, draftOf(s, ''))).toEqual({ kind: 'unchanged' });
  });

  it('refuses to clear a price and to read garbage', () => {
    const s = stand();
    expect(diffStand(s, { ...draftOf(s, '1500'), price: '' }).kind).toBe('invalid');
    expect(diffStand(s, { ...draftOf(s, '1500'), price: 'caro' }).kind).toBe('invalid');
    expect(diffStand(s, { ...draftOf(s, '1500'), price: '1,234' }).kind).toBe('invalid');
  });

  it('sends the sector, including clearing it, and the status', () => {
    const s = stand({ sectorId: 'sec1' });
    expect(diffStand(s, { ...draftOf(s, '1500'), sectorId: null, status: 'BLOCKED' })).toEqual({
      kind: 'changed',
      delta: { sectorId: null, status: 'BLOCKED' },
    });
  });

  it('never sends ASSIGNED as a status', () => {
    const s = stand({ status: 'ASSIGNED' });
    expect(diffStand(s, draftOf(s, '1500'))).toEqual({ kind: 'unchanged' });
  });
});

describe('groupChanges', () => {
  it('groups the rows that share one change into a single request', () => {
    const groups = groupChanges([
      { id: 'a', delta: { priceCents: 100 } },
      { id: 'b', delta: { priceCents: 200 } },
      { id: 'c', delta: { priceCents: 100 } },
      { id: 'd', delta: { priceCents: 100, sectorId: 's1' } },
    ]);
    expect(groups).toEqual([
      { priceCents: 100, standIds: ['a', 'c'] },
      { priceCents: 200, standIds: ['b'] },
      { priceCents: 100, sectorId: 's1', standIds: ['d'] },
    ]);
  });

  it('keeps null (clear the sector) apart from not touching it', () => {
    const groups = groupChanges([
      { id: 'a', delta: { sectorId: null } },
      { id: 'b', delta: { status: 'BLOCKED' } },
    ]);
    expect(groups).toHaveLength(2);
  });
});

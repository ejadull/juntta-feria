import { dateErrors, isoToLocal, localToIso } from './event-dates';

const OK = {
  startsAt: '2026-11-20T10:00',
  endsAt: '2026-11-22T20:00',
  salesOpenAt: '2026-10-01T00:00',
  salesCloseAt: '2026-11-19T00:00',
};

describe('event dates', () => {
  it('adds the Argentina offset the API requires', () => {
    expect(localToIso('2026-11-20T10:00')).toBe('2026-11-20T10:00:00-03:00');
  });

  it('rejects text that is not a local date and time', () => {
    expect(localToIso('')).toBeNull();
    expect(localToIso('20/11/2026')).toBeNull();
    expect(localToIso('2026-13-40T10:00')).toBeNull();
  });

  it('round-trips an API instant into the input value', () => {
    expect(isoToLocal('2026-11-20T13:00:00.000Z')).toBe('2026-11-20T10:00');
    expect(isoToLocal(localToIso('2026-11-20T23:30') ?? '')).toBe('2026-11-20T23:30');
  });

  it('accepts coherent dates', () => {
    expect(dateErrors(OK)).toEqual({});
  });

  it('flags every date that is missing', () => {
    expect(Object.keys(dateErrors({ ...OK, startsAt: '', salesOpenAt: '' }))).toEqual([
      'startsAt',
      'salesOpenAt',
    ]);
  });

  it('requires the end after the start', () => {
    expect(dateErrors({ ...OK, endsAt: '2026-11-20T10:00' }).endsAt).toContain(
      'posterior al inicio',
    );
  });

  it('requires sales to open before they close', () => {
    expect(dateErrors({ ...OK, salesCloseAt: '2026-10-01T00:00' }).salesCloseAt).toContain(
      'posterior a la apertura',
    );
  });

  it('does not let sales close after the event ends', () => {
    expect(dateErrors({ ...OK, salesCloseAt: '2026-11-23T00:00' }).salesCloseAt).toContain(
      'después de que termina',
    );
  });
});

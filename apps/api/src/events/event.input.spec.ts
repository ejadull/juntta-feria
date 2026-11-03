import { datesProblem, slugify } from './event.input.js';

describe('slugify', () => {
  it.each([
    ['Feria de Primavera 2026', 'feria-de-primavera-2026'],
    ['  Diseño & Moda — Edición Otoño ', 'diseno-moda-edicion-otono'],
    ['¡¡¡', 'evento'],
    ['a'.repeat(79) + ' b', 'a'.repeat(79)],
  ])('%s → %s', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});

describe('datesProblem', () => {
  const d = (iso: string) => new Date(iso);
  const ok = {
    salesOpenAt: d('2026-11-01T00:00:00Z'),
    salesCloseAt: d('2026-12-01T00:00:00Z'),
    startsAt: d('2026-12-05T00:00:00Z'),
    endsAt: d('2026-12-07T00:00:00Z'),
  };

  it('accepts coherent dates, sales closing exactly at the end included', () => {
    expect(datesProblem(ok)).toBeNull();
    expect(datesProblem({ ...ok, salesCloseAt: ok.endsAt })).toBeNull();
  });

  it.each([
    [{ endsAt: d('2026-12-05T00:00:00Z') }, /startsAt/],
    [{ salesCloseAt: d('2026-11-01T00:00:00Z') }, /salesOpenAt/],
    [{ salesCloseAt: d('2026-12-08T00:00:00Z') }, /salesCloseAt/],
  ])('rejects %o', (change, message) => {
    expect(datesProblem({ ...ok, ...change })).toMatch(message);
  });
});

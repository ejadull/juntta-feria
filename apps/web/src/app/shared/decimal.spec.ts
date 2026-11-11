import { centsToInput, parseDecimal, parsePesosToCents } from './decimal';

describe('parseDecimal', () => {
  it.each([
    ['1500', 1500],
    ['1500,5', 1500.5],
    ['12.5', 12.5],
    ['1.500,50', 1500.5],
    ['1.500', 1500],
    ['$ 20', 20],
    ['0', 0],
  ])('reads %s as %d', (text, value) => expect(parseDecimal(text)).toBe(value));

  it.each(['', 'abc', '-5', '1,234', '1,2,3', '12.', ',5'])('rejects "%s"', (text) =>
    expect(parseDecimal(text)).toBeNull(),
  );
});

describe('money inputs', () => {
  it('turns pesos into integer cents without float drift', () => {
    expect(parsePesosToCents('1.740.000')).toBe(174_000_000);
    expect(parsePesosToCents('19,99')).toBe(1999);
    expect(parsePesosToCents('x')).toBeNull();
  });

  it('shows cents as an editable amount', () => {
    expect(centsToInput(174_000_000)).toBe('1740000');
    expect(centsToInput(1950)).toBe('19,5');
    expect(centsToInput(1999)).toBe('19,99');
  });
});

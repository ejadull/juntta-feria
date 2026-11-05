import { normalizeCuit } from './cuit.js';

describe('normalizeCuit (AFIP mod 11 check digit)', () => {
  it.each([
    ['20-12345678-6', '20123456786'],
    ['20123456786', '20123456786'],
    [' 30-71234567-1 ', '30712345671'],
    ['27 28033514 8', '27280335148'],
  ])('accepts %s as %s', (input, digits) => {
    expect(normalizeCuit(input)).toBe(digits);
  });

  it.each([
    ['20-12345678-5', 'wrong check digit'],
    ['2012345678', 'ten digits'],
    ['201234567861', 'twelve digits'],
    ['20-1234567A-6', 'a letter'],
    ['', 'empty'],
  ])('rejects %s (%s)', (input) => {
    expect(normalizeCuit(input)).toBeNull();
  });
});

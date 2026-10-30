import { correlationIdFrom } from './correlation-id.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('correlationIdFrom', () => {
  it('keeps a safe incoming id', () => {
    expect(correlationIdFrom('req-123_abc.DEF')).toBe('req-123_abc.DEF');
  });

  it('uses the first value when the header is repeated', () => {
    expect(correlationIdFrom(['first-id-1', 'second-id-2'])).toBe('first-id-1');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['too short', 'abc'],
    ['too long', 'a'.repeat(129)],
    ['log injection', 'id-1234\nFAKE LOG LINE'],
    ['spaces', 'id with spaces'],
  ])('generates a UUID when the header is %s', (_, header) => {
    expect(correlationIdFrom(header)).toMatch(UUID);
  });

  it('generates a different id each time', () => {
    expect(correlationIdFrom(undefined)).not.toBe(correlationIdFrom(undefined));
  });
});

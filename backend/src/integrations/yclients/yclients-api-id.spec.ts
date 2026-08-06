import { normalizeYclientsSystemApiId } from './yclients-api-id';

describe('normalizeYclientsSystemApiId', () => {
  it.each([
    [1, 1],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ['1', 1],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])('accepts canonical system id %p without loss', (value, expected) => {
    expect(normalizeYclientsSystemApiId(value)).toEqual({
      outcome: 'present',
      value: expected,
    });
  });

  it.each([undefined, null, '', '   '])(
    'treats %p as an absent provider id',
    (value) => {
      expect(normalizeYclientsSystemApiId(value)).toEqual({
        outcome: 'missing',
      });
    },
  );

  it.each([
    0,
    -1,
    1.5,
    '0',
    '01',
    '+1',
    '-1',
    ' 1',
    '1 ',
    '1e0',
    '1.0',
    '9007199254740992',
    true,
    {},
  ])('rejects ambiguous or unsafe provider id %p', (value) => {
    expect(normalizeYclientsSystemApiId(value)).toEqual({
      outcome: 'invalid',
    });
  });
});

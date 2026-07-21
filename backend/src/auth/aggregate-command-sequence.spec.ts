import {
  aggregateCommandSequence,
  isAggregateCommandSequence,
} from './aggregate-command-sequence';

describe('aggregate command sequence', () => {
  it('accepts one-based positive safe integers', () => {
    expect(aggregateCommandSequence(1)).toBe(1);
    expect(isAggregateCommandSequence(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '1',
    null,
  ])('rejects invalid sequence %#', (value) => {
    expect(isAggregateCommandSequence(value)).toBe(false);
    expect(() => aggregateCommandSequence(value as number)).toThrow(
      'Aggregate command sequence is invalid',
    );
  });
});

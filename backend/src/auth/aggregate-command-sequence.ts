declare const aggregateCommandSequenceBrand: unique symbol;

/**
 * One-based command position within a single aggregate history.
 *
 * It is not a timestamp, UUID, or global sequence. A future repository assigns
 * it only while holding the parent aggregate lock.
 */
export type AggregateCommandSequence = number & {
  readonly [aggregateCommandSequenceBrand]: 'AggregateCommandSequence';
};

export function isAggregateCommandSequence(
  value: unknown,
): value is AggregateCommandSequence {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function aggregateCommandSequence(
  value: number,
): AggregateCommandSequence {
  if (!isAggregateCommandSequence(value)) {
    throw new TypeError('Aggregate command sequence is invalid');
  }

  return value;
}

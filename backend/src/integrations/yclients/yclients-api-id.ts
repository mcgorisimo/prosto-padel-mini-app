export type YclientsSystemApiIdNormalization =
  | Readonly<{ outcome: 'present'; value: number }>
  | Readonly<{ outcome: 'missing' }>
  | Readonly<{ outcome: 'invalid' }>;

const MISSING = Object.freeze({ outcome: 'missing' as const });
const INVALID = Object.freeze({ outcome: 'invalid' as const });

/**
 * Normalizes only server-created positive identifiers without lossy parsing.
 * Decimal strings must already be canonical provider representations.
 */
export function normalizeYclientsSystemApiId(
  value: unknown,
): YclientsSystemApiIdNormalization {
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim().length === 0)
  ) {
    return MISSING;
  }
  if (Number.isSafeInteger(value) && Number(value) > 0) {
    return Object.freeze({ outcome: 'present' as const, value: Number(value) });
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) {
    return INVALID;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === value
    ? Object.freeze({ outcome: 'present' as const, value: parsed })
    : INVALID;
}

import { createHash } from 'node:crypto';

import {
  InternalUuid,
  internalUuid,
} from '../src/common/internal-uuid';

/** Stable UUID v4 fixture derived from a human-readable test label. */
export function deterministicUuid(label: string): InternalUuid {
  const bytes = createHash('sha256')
    .update(`prosto-padel-test:${label}`, 'utf8')
    .digest()
    .subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return internalUuid(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  );
}

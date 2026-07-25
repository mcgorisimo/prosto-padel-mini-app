import { createHash } from 'node:crypto';
import { InternalUuid, internalUuid } from '../common/internal-uuid';

const UINT32_MAX = 0xffff_ffff;

export function encodeLengthPrefixedUtf8(
  values: readonly string[],
): Buffer {
  const chunks: Buffer[] = [];

  for (const value of values) {
    if (typeof value !== 'string') {
      throw new TypeError('Length-prefixed value is invalid');
    }

    const encoded = Buffer.from(value, 'utf8');
    if (encoded.length > UINT32_MAX) {
      throw new TypeError('Length-prefixed value is too long');
    }

    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(encoded.length);
    chunks.push(length, encoded);
  }

  return Buffer.concat(chunks);
}

function uuidBytes(value: string): Buffer {
  const canonical = internalUuid(value);
  return Buffer.from(canonical.replaceAll('-', ''), 'hex');
}

function formatUuid(bytes: Buffer): InternalUuid {
  const hex = bytes.toString('hex');
  return internalUuid(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  );
}

export function uuidV5FromParts(
  namespace: string,
  nameParts: readonly string[],
): InternalUuid {
  const digest = createHash('sha1')
    .update(uuidBytes(namespace))
    .update(encodeLengthPrefixedUtf8(nameParts))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

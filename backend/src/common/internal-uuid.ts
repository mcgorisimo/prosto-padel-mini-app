import { randomUUID } from 'node:crypto';

declare const internalUuidBrand: unique symbol;

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** A canonical lowercase RFC 9562 UUID used only for internal domain IDs. */
export type InternalUuid = string & {
  readonly [internalUuidBrand]: 'InternalUuid';
};

export function isInternalUuid(value: unknown): value is InternalUuid {
  return typeof value === 'string' && CANONICAL_UUID_PATTERN.test(value);
}

export function internalUuid(value: string): InternalUuid {
  if (!isInternalUuid(value)) {
    throw new TypeError('Internal UUID is invalid');
  }

  return value;
}

/** Generates a version 4 UUID using the standard Node.js cryptographic API. */
export function newInternalUuid(): InternalUuid {
  return randomUUID() as InternalUuid;
}

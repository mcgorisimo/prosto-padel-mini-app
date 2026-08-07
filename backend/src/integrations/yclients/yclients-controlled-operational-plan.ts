import { createHash, createHmac } from 'node:crypto';
import type { YclientsCreateBookingCommand } from './yclients-api.client';
import type { YclientsControlledRootOnlyFileStore } from './yclients-controlled-artifacts';
import {
  createYclientsControlledPlanDigest,
  YclientsControlledIdentityVerifier,
  YclientsControlledRunnerPlan,
} from './yclients-controlled-runner';

export const YCLIENTS_CONTROLLED_PLAN_DIGEST =
  '5ab6f618addc65d2fb669d8adfa288e601fd9ac89ffa45529ec00c59e2fc916d';
export const YCLIENTS_CONTROLLED_IDENTITY_BINDING =
  'd2-disposable-identity-v1';

const IDENTITY_MAX_UTF8_BYTES = 2_048;
const SECRET_MAX_UTF8_BYTES = 4_096;
const PHONE_PATTERN = /^\d{10,15}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const UNSAFE_TEXT_PATTERN = /[\u0000-\u001f\u007f\ufffd]/u;
const IDENTITY_KEY_DOMAIN = Buffer.from(
  'prosto-padel/d2-controlled-identity-key/v1\0',
  'utf8',
);
const IDENTITY_BINDING_DOMAIN = Buffer.from(
  'prosto-padel/d2-controlled-identity-binding/v1\0',
  'utf8',
);
const EXECUTION_APPROVAL_DOMAIN = Buffer.from(
  'prosto-padel/d2-controlled-execution-approval/v1\0',
  'utf8',
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function invalidIdentity(): never {
  throw new TypeError('Invalid controlled identity');
}

export class YclientsControlledLoadedIdentity
  implements YclientsControlledIdentityVerifier
{
  readonly binding = YCLIENTS_CONTROLLED_IDENTITY_BINDING;
  readonly #client: YclientsCreateBookingCommand['client'];

  constructor(client: YclientsCreateBookingCommand['client']) {
    this.#client = Object.freeze({ ...client });
  }

  clientForPlan(): YclientsCreateBookingCommand['client'] {
    return this.#client;
  }

  keyedBindingDigest(key: Buffer): string {
    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw new TypeError('Invalid controlled identity key');
    }
    return createHmac('sha256', key)
      .update(IDENTITY_BINDING_DOMAIN)
      .update(
        JSON.stringify({
          version: 1,
          binding: this.binding,
          fullName: this.#client.fullName,
          phone: this.#client.phone,
          email: this.#client.email,
        }),
        'utf8',
      )
      .digest('hex');
  }

  verify(
    identityBinding: string,
    client: YclientsCreateBookingCommand['client'],
  ): boolean {
    return (
      identityBinding === this.binding &&
      client?.phone === this.#client.phone &&
      client?.fullName === this.#client.fullName &&
      client?.email === this.#client.email
    );
  }

  toJSON(): Readonly<{ binding: string; loaded: true }> {
    return Object.freeze({ binding: this.binding, loaded: true as const });
  }
}

export async function loadYclientsControlledIdentity(
  store: YclientsControlledRootOnlyFileStore,
  identityPath: string,
): Promise<YclientsControlledLoadedIdentity> {
  let raw: string | undefined;
  try {
    raw = await store.read(identityPath, IDENTITY_MAX_UTF8_BYTES);
  } catch {
    return invalidIdentity();
  }
  if (raw === undefined) return invalidIdentity();
  const text = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
  if (
    text.endsWith('\r') ||
    text.length === 0 ||
    UNSAFE_TEXT_PATTERN.test(text)
  ) {
    return invalidIdentity();
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalidIdentity();
  }
  if (
    !isRecord(value) ||
    !exactKeys(value, ['version', 'binding', 'fullName', 'phone', 'email']) ||
    value.version !== 1 ||
    value.binding !== YCLIENTS_CONTROLLED_IDENTITY_BINDING ||
    typeof value.fullName !== 'string' ||
    value.fullName.trim() !== value.fullName ||
    value.fullName.length === 0 ||
    Buffer.byteLength(value.fullName, 'utf8') > 256 ||
    UNSAFE_TEXT_PATTERN.test(value.fullName) ||
    typeof value.phone !== 'string' ||
    !PHONE_PATTERN.test(value.phone) ||
    typeof value.email !== 'string' ||
    value.email.trim() !== value.email ||
    Buffer.byteLength(value.email, 'utf8') > 320 ||
    !EMAIL_PATTERN.test(value.email) ||
    UNSAFE_TEXT_PATTERN.test(value.email)
  ) {
    return invalidIdentity();
  }
  const canonical = JSON.stringify({
    version: 1,
    binding: value.binding,
    fullName: value.fullName,
    phone: value.phone,
    email: value.email,
  });
  if (canonical !== text) {
    return invalidIdentity();
  }

  return new YclientsControlledLoadedIdentity(
    Object.freeze({
      phone: value.phone,
      fullName: value.fullName,
      email: value.email,
    }),
  );
}

export function createYclientsControlledExecutionApprovalDigest(
  identity: YclientsControlledLoadedIdentity,
  planDigest: string,
  partnerToken: string,
  userToken: string,
): string {
  if (
    !/^[a-f0-9]{64}$/u.test(planDigest) ||
    partnerToken.length === 0 ||
    userToken.length === 0
  ) {
    throw new TypeError('Invalid controlled approval input');
  }
  const key = createHmac('sha256', Buffer.from(partnerToken, 'utf8'))
    .update(IDENTITY_KEY_DOMAIN)
    .update(Buffer.from(userToken, 'utf8'))
    .digest();
  const identityBindingDigest = identity.keyedBindingDigest(key);
  key.fill(0);
  return createHash('sha256')
    .update(EXECUTION_APPROVAL_DOMAIN)
    .update(planDigest, 'utf8')
    .update(identityBindingDigest, 'utf8')
    .digest('hex');
}

export async function loadYclientsControlledRootOnlySecret(
  store: YclientsControlledRootOnlyFileStore,
  secretPath: string,
): Promise<string> {
  let raw: string | undefined;
  try {
    raw = await store.read(secretPath, SECRET_MAX_UTF8_BYTES);
  } catch {
    throw new TypeError('Invalid controlled secret');
  }
  if (raw === undefined || raw.length === 0) {
    throw new TypeError('Invalid controlled secret');
  }
  const secret = raw.replace(/(?:(?:\r\n)|\r|\n)+$/u, '');
  if (
    secret.length === 0 ||
    secret.trim().length === 0 ||
    Buffer.byteLength(secret, 'utf8') > SECRET_MAX_UTF8_BYTES ||
    UNSAFE_TEXT_PATTERN.test(secret)
  ) {
    throw new TypeError('Invalid controlled secret');
  }
  return secret;
}

export function buildYclientsControlledOperationalPlan(
  identity: YclientsControlledLoadedIdentity,
): YclientsControlledRunnerPlan {
  const plan: YclientsControlledRunnerPlan = Object.freeze({
    planVersion: 1,
    planId: 'd2-controlled-basic-20260817',
    companyId: 2_079_564,
    identityBinding: YCLIENTS_CONTROLLED_IDENTITY_BINDING,
    lifecycle: Object.freeze({
      apiId: 184_993_463_877_968,
      client: identity.clientForPlan(),
      slotA: Object.freeze({
        alias: 'A' as const,
        serviceId: 30_539_679,
        resourceId: 5_730_531,
        datetime: '2026-08-17T12:00:00+03:00',
      }),
      slotB: Object.freeze({
        alias: 'B' as const,
        serviceId: 30_539_679,
        resourceId: 5_762_241,
        datetime: '2026-08-18T12:00:00+03:00',
      }),
      visibleListA: Object.freeze({
        page: 1,
        count: 50,
        resourceId: 5_730_531,
        dateFrom: '2026-08-17',
        dateTo: '2026-08-17',
        withDeleted: false,
      }),
      deletedListB: Object.freeze({
        page: 1,
        count: 50,
        resourceId: 5_762_241,
        dateFrom: '2026-08-18',
        dateTo: '2026-08-18',
        withDeleted: true,
      }),
    }),
  });
  if (
    createYclientsControlledPlanDigest(plan) !==
    YCLIENTS_CONTROLLED_PLAN_DIGEST
  ) {
    throw new TypeError('Controlled plan integrity failure');
  }
  return plan;
}

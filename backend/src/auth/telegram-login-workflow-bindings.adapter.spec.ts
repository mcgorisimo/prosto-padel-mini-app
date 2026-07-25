import { createHash, createHmac } from 'node:crypto';
import {
  AuthenticationProofFingerprint,
  VerifiedTelegramProof,
  unixEpochSeconds,
} from './auth.types';
import {
  externalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from '../accounts/external-identity.types';
import {
  DeterministicTelegramLoginWorkflowBindingsAdapter,
  TelegramLoginWorkflowBindingsAdapterError,
} from './telegram-login-workflow-bindings.adapter';

const UUID_NAMESPACE = '12345678-1234-5678-9234-567812345678';
const SECRET = Buffer.from('55'.repeat(32), 'hex');
const REQUEST_KEY = 'telegram-login-request-123';
const FINGERPRINT = '66'.repeat(32) as AuthenticationProofFingerprint;
const NOW = unixEpochSeconds(1_800_000_000);

function encode(values: readonly string[]): Buffer {
  const chunks: Buffer[] = [];
  for (const value of values) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    chunks.push(length, bytes);
  }
  return Buffer.concat(chunks);
}

function expectedUuidV5(label: string): string {
  const namespace = Buffer.from(UUID_NAMESPACE.replaceAll('-', ''), 'hex');
  const digest = createHash('sha1')
    .update(namespace)
    .update(encode([label, REQUEST_KEY, FINGERPRINT]))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function adapter(
  secret = SECRET,
): DeterministicTelegramLoginWorkflowBindingsAdapter {
  return new DeterministicTelegramLoginWorkflowBindingsAdapter({
    uuidNamespace: UUID_NAMESPACE,
    hmacSecret: secret,
    operationTtlSeconds: 300,
    sessionTtlSeconds: 2_592_000,
  });
}

function proof(
  fingerprint = FINGERPRINT,
  namespace = 'telegram:bot:123456',
): VerifiedTelegramProof {
  const brandedNamespace = externalIdentityNamespace(namespace);
  return {
    provider: 'telegram',
    namespace: brandedNamespace,
    identityKey: {
      provider: 'telegram',
      namespace: brandedNamespace,
      lookup: {
        kind: 'canonical_subject',
        subject:
          trustProviderCanonicalizedExternalIdentitySubject('987654321'),
      },
    },
    authDate: unixEpochSeconds(1_799_999_900),
    verifiedAt: NOW,
    expiresAt: unixEpochSeconds(1_800_001_000),
    proofFingerprint: fingerprint,
  };
}

function allUuids(
  value: ReturnType<DeterministicTelegramLoginWorkflowBindingsAdapter['create']>,
): readonly string[] {
  return [
    value.operationId,
    value.terminalCommandId,
    value.accountId,
    value.identityId,
    value.sessionId,
    ...Object.values(value.auditEventIds),
  ];
}

describe('DeterministicTelegramLoginWorkflowBindingsAdapter', () => {
  it('is deterministic across adapter instances', () => {
    const first = adapter().create(REQUEST_KEY, proof(), NOW);
    const second = adapter(Buffer.from(SECRET)).create(
      REQUEST_KEY,
      proof(),
      NOW,
    );
    expect(second).toEqual(first);
  });

  it('uses distinct canonical UUIDv5 values for every label', () => {
    const result = adapter().create(REQUEST_KEY, proof(), NOW);
    const ids = allUuids(result);
    expect(new Set(ids).size).toBe(10);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
    }
  });

  it('derives UUIDv5 from namespace bytes and the length-prefixed name', () => {
    const result = adapter().create(REQUEST_KEY, proof(), NOW);
    expect(result.operationId).toBe(
      expectedUuidV5('telegram-login/v1/operation'),
    );
    expect(result.auditEventIds.sessionCreated).toBe(
      expectedUuidV5('telegram-login/v1/audit-session-created'),
    );
  });

  it('computes the exact idempotency and request digests', () => {
    const result = adapter().create(REQUEST_KEY, proof(), NOW);
    const expectedIdempotency = createHmac('sha256', SECRET)
      .update(
        encode([
          'prosto-padel/telegram-login-idempotency/v1',
          REQUEST_KEY,
        ]),
      )
      .digest('hex');
    const expectedRequest = createHash('sha256')
      .update(
        encode([
          'prosto-padel/telegram-login-request/v1',
          REQUEST_KEY,
          'sign_up',
          'telegram',
          'telegram:bot:123456',
          FINGERPRINT,
        ]),
      )
      .digest('hex');

    expect(result.idempotencyKey).toBe(expectedIdempotency);
    expect(result.requestDigest).toBe(expectedRequest);
  });

  it('changes all deterministic bindings for a different request key', () => {
    const first = adapter().create(REQUEST_KEY, proof(), NOW);
    const second = adapter().create(`${REQUEST_KEY}-other`, proof(), NOW);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(second.requestDigest).not.toBe(first.requestDigest);
    expect(allUuids(second)).not.toEqual(allUuids(first));
  });

  it('changes UUIDs and request digest but not idempotency key for another fingerprint', () => {
    const first = adapter().create(REQUEST_KEY, proof(), NOW);
    const second = adapter().create(
      REQUEST_KEY,
      proof('77'.repeat(32) as AuthenticationProofFingerprint),
      NOW,
    );
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.requestDigest).not.toBe(first.requestDigest);
    expect(allUuids(second)).not.toEqual(allUuids(first));
  });

  it('domain-separates namespace in the request digest', () => {
    const first = adapter().create(REQUEST_KEY, proof(), NOW);
    const second = adapter().create(
      REQUEST_KEY,
      proof(FINGERPRINT, 'telegram:bot:654321'),
      NOW,
    );
    expect(second.requestDigest).not.toBe(first.requestDigest);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('maps now and the configured TTLs exactly', () => {
    const result = adapter().create(REQUEST_KEY, proof(), NOW);
    expect(result.timestamps).toEqual({
      operationCreatedAt: NOW,
      operationExpiresAt: NOW + 300,
      proofConsumedAt: NOW,
      accountCreatedAt: NOW,
      terminalAppliedAt: NOW,
      sessionCreatedAt: NOW,
      sessionExpiresAt: NOW + 2_592_000,
      credentialIssuedAt: NOW,
      auditOccurredAt: NOW,
    });
  });

  it('rejects safe-integer timestamp overflow', () => {
    const maximum = unixEpochSeconds(Number.MAX_SAFE_INTEGER);
    const nearMaximumProof = {
      ...proof(),
      verifiedAt: maximum,
      expiresAt: maximum,
    };
    expect(() =>
      adapter().create(REQUEST_KEY, nearMaximumProof, maximum),
    ).toThrow(expect.objectContaining({ reason: 'timestamp_overflow' }));
  });

  it('copies the HMAC secret supplied to the constructor', () => {
    const mutable = Buffer.from(SECRET);
    const instance = adapter(mutable);
    const before = instance.create(REQUEST_KEY, proof(), NOW);
    mutable.fill(0xff);
    const after = instance.create(REQUEST_KEY, proof(), NOW);
    expect(after).toEqual(before);
  });

  it('does not expose workflow secret or Telegram subject in result or errors', () => {
    const secretMarker = 'workflow-secret-marker-that-is-long-enough';
    const subjectMarker = 'telegram-subject-secret-marker';
    const secret = Buffer.from(secretMarker.padEnd(40, '!'));
    const instance = adapter(secret);
    const markedProof = proof();
    const withMarkedSubject = {
      ...markedProof,
      identityKey: {
        ...markedProof.identityKey,
        lookup: {
          kind: 'canonical_subject' as const,
          subject:
            trustProviderCanonicalizedExternalIdentitySubject(subjectMarker),
        },
      },
    };
    const result = instance.create(REQUEST_KEY, withMarkedSubject, NOW);
    expect(JSON.stringify(result)).not.toContain(secretMarker);
    expect(JSON.stringify(result)).not.toContain(subjectMarker);

    let caught: unknown;
    try {
      instance.create('\u0000invalid-request-key', withMarkedSubject, NOW);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(
      TelegramLoginWorkflowBindingsAdapterError,
    );
    const safe = caught as TelegramLoginWorkflowBindingsAdapterError;
    expect(Object.getOwnPropertyNames(safe).sort()).toEqual(
      ['message', 'name', 'reason', 'stack'].sort(),
    );
    expect('cause' in safe).toBe(false);
    const serialized = `${safe.message}\n${safe.stack}\n${JSON.stringify(safe)}`;
    expect(serialized).not.toContain(secretMarker);
    expect(serialized).not.toContain(subjectMarker);
  });
});

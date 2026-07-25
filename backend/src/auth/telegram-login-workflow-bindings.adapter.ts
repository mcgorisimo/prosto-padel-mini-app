import { createHash, createHmac } from 'node:crypto';
import { AccountId } from '../accounts/account.types';
import { ExternalIdentityId } from '../accounts/external-identity-lifecycle.types';
import { externalIdentityNamespace } from '../accounts/external-identity.types';
import { InternalUuid, internalUuid } from '../common/internal-uuid';
import {
  AuthenticationCommandId,
  AuthenticationIdempotencyKey,
  AuthenticationOperationId,
  AuthenticationRequestDigest,
  VerifiedTelegramProof,
  isAuthenticationIdempotencyKey,
  isAuthenticationProofFingerprint,
  isAuthenticationRequestDigest,
  isUnixEpochSeconds,
  unixEpochSeconds,
} from './auth.types';
import { encodeLengthPrefixedUtf8, uuidV5FromParts } from './crypto-encoding';
import { SecurityAuditEventId } from './security-audit.types';
import { SessionId } from './session.types';
import {
  TelegramLoginWorkflowBindings,
  TelegramLoginWorkflowBindingsPort,
} from './telegram-login.ports';

const MINIMUM_HMAC_SECRET_BYTES = 32;
const REQUEST_KEY_MAX_LENGTH = 256;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const IDEMPOTENCY_DOMAIN =
  'prosto-padel/telegram-login-idempotency/v1';
const REQUEST_DOMAIN = 'prosto-padel/telegram-login-request/v1';
const INTENT = 'sign_up' as const;

const UUID_LABELS = Object.freeze({
  operationId: 'telegram-login/v1/operation',
  terminalCommandId: 'telegram-login/v1/terminal-command',
  accountId: 'telegram-login/v1/account',
  identityId: 'telegram-login/v1/identity',
  sessionId: 'telegram-login/v1/session',
  proofConsumption: 'telegram-login/v1/audit-pending',
  accountCreated: 'telegram-login/v1/audit-account-created',
  externalIdentityLinked: 'telegram-login/v1/audit-identity-linked',
  operationTerminal: 'telegram-login/v1/audit-terminal',
  sessionCreated: 'telegram-login/v1/audit-session-created',
});

export interface TelegramLoginWorkflowBindingsAdapterConfig {
  readonly uuidNamespace: string;
  readonly hmacSecret: Buffer;
  readonly operationTtlSeconds: number;
  readonly sessionTtlSeconds: number;
}

export type TelegramLoginWorkflowBindingsAdapterFailure =
  | 'invalid_config'
  | 'invalid_input'
  | 'timestamp_overflow'
  | 'crypto_failure';

export class TelegramLoginWorkflowBindingsAdapterError extends Error {
  readonly name = 'TelegramLoginWorkflowBindingsAdapterError';

  constructor(readonly reason: TelegramLoginWorkflowBindingsAdapterFailure) {
    super('Telegram login workflow binding creation failed');
  }
}

function failure(
  reason: TelegramLoginWorkflowBindingsAdapterFailure,
): TelegramLoginWorkflowBindingsAdapterError {
  return new TelegramLoginWorkflowBindingsAdapterError(reason);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validRequestKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= REQUEST_KEY_MAX_LENGTH &&
    value.trim() === value &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function addTimestamp(value: number, delta: number): number {
  const result = value + delta;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw failure('timestamp_overflow');
  }
  return result;
}

function asAuthenticationIdempotencyKey(
  value: string,
): AuthenticationIdempotencyKey {
  if (!isAuthenticationIdempotencyKey(value)) {
    throw failure('crypto_failure');
  }
  return value;
}

function asAuthenticationRequestDigest(
  value: string,
): AuthenticationRequestDigest {
  if (!isAuthenticationRequestDigest(value)) {
    throw failure('crypto_failure');
  }
  return value;
}

/**
 * Bindings are deterministic for the same requestKey, proof fingerprint and
 * now. Transparent recovery after a completed lost HTTP response is outside
 * the MVP contract.
 */
export class DeterministicTelegramLoginWorkflowBindingsAdapter
  implements TelegramLoginWorkflowBindingsPort
{
  readonly #uuidNamespace: InternalUuid;
  readonly #hmacSecret: Buffer;
  readonly #operationTtlSeconds: number;
  readonly #sessionTtlSeconds: number;

  constructor(config: TelegramLoginWorkflowBindingsAdapterConfig) {
    try {
      if (
        typeof config !== 'object' ||
        config === null ||
        !Buffer.isBuffer(config.hmacSecret) ||
        config.hmacSecret.length < MINIMUM_HMAC_SECRET_BYTES ||
        !isPositiveSafeInteger(config.operationTtlSeconds) ||
        !isPositiveSafeInteger(config.sessionTtlSeconds)
      ) {
        throw failure('invalid_config');
      }

      this.#uuidNamespace = internalUuid(config.uuidNamespace);
      this.#hmacSecret = Buffer.from(config.hmacSecret);
      this.#operationTtlSeconds = config.operationTtlSeconds;
      this.#sessionTtlSeconds = config.sessionTtlSeconds;
    } catch (error) {
      if (error instanceof TelegramLoginWorkflowBindingsAdapterError) {
        throw error;
      }
      throw failure('invalid_config');
    }
  }

  create(
    requestKey: string,
    proof: VerifiedTelegramProof,
    now: ReturnType<typeof unixEpochSeconds>,
  ): TelegramLoginWorkflowBindings {
    try {
      if (
        !validRequestKey(requestKey) ||
        typeof proof !== 'object' ||
        proof === null ||
        proof.provider !== 'telegram' ||
        !isAuthenticationProofFingerprint(proof.proofFingerprint) ||
        !isUnixEpochSeconds(proof.authDate) ||
        !isUnixEpochSeconds(proof.verifiedAt) ||
        !isUnixEpochSeconds(proof.expiresAt) ||
        !isUnixEpochSeconds(now)
      ) {
        throw failure('invalid_input');
      }
      const namespace = externalIdentityNamespace(proof.namespace);
      const operationExpiresAt = addTimestamp(
        now,
        this.#operationTtlSeconds,
      );
      const sessionExpiresAt = addTimestamp(now, this.#sessionTtlSeconds);
      if (operationExpiresAt > proof.expiresAt) {
        throw failure('invalid_input');
      }

      const uuid = (label: string): InternalUuid =>
        uuidV5FromParts(this.#uuidNamespace, [
          label,
          requestKey,
          proof.proofFingerprint,
        ]);

      const idempotencyKey = asAuthenticationIdempotencyKey(
        createHmac('sha256', this.#hmacSecret)
          .update(
            encodeLengthPrefixedUtf8([IDEMPOTENCY_DOMAIN, requestKey]),
          )
          .digest('hex'),
      );
      const requestDigest = asAuthenticationRequestDigest(
        createHash('sha256')
          .update(
            encodeLengthPrefixedUtf8([
              REQUEST_DOMAIN,
              requestKey,
              INTENT,
              proof.provider,
              namespace,
              proof.proofFingerprint,
            ]),
          )
          .digest('hex'),
      );

      const timestamps = Object.freeze({
        operationCreatedAt: now,
        operationExpiresAt: unixEpochSeconds(operationExpiresAt),
        proofConsumedAt: now,
        accountCreatedAt: now,
        terminalAppliedAt: now,
        sessionCreatedAt: now,
        sessionExpiresAt: unixEpochSeconds(sessionExpiresAt),
        credentialIssuedAt: now,
        auditOccurredAt: now,
      });

      return Object.freeze({
        operationId: uuid(UUID_LABELS.operationId) as AuthenticationOperationId,
        idempotencyKey,
        requestDigest,
        terminalCommandId: uuid(
          UUID_LABELS.terminalCommandId,
        ) as AuthenticationCommandId,
        accountId: uuid(UUID_LABELS.accountId) as AccountId,
        identityId: uuid(UUID_LABELS.identityId) as ExternalIdentityId,
        sessionId: uuid(UUID_LABELS.sessionId) as SessionId,
        auditEventIds: Object.freeze({
          proofConsumption: uuid(
            UUID_LABELS.proofConsumption,
          ) as SecurityAuditEventId,
          accountCreated: uuid(
            UUID_LABELS.accountCreated,
          ) as SecurityAuditEventId,
          externalIdentityLinked: uuid(
            UUID_LABELS.externalIdentityLinked,
          ) as SecurityAuditEventId,
          operationTerminal: uuid(
            UUID_LABELS.operationTerminal,
          ) as SecurityAuditEventId,
          sessionCreated: uuid(
            UUID_LABELS.sessionCreated,
          ) as SecurityAuditEventId,
        }),
        timestamps,
      });
    } catch (error) {
      if (error instanceof TelegramLoginWorkflowBindingsAdapterError) {
        throw error;
      }
      if (error instanceof TypeError) {
        throw failure('invalid_input');
      }
      throw failure('crypto_failure');
    }
  }
}

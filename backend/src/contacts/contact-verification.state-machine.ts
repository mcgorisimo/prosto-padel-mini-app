import { timingSafeEqual } from 'node:crypto';
import { AccountId, isAccountId } from '../accounts/account.types';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../auth/auth.types';
import { InternalUuid, isInternalUuid } from '../common/internal-uuid';
import {
  MAX_CONTACT_VERIFICATION_ATTEMPTS,
  MAX_CONTACT_VERIFICATION_TTL_SECONDS,
  DEFAULT_CONTACT_VERIFICATION_POLICY,
  ContactVerificationChallengeId,
  ContactVerificationCommandId,
  ContactVerificationField,
  ContactVerificationIdempotencyKey,
  ContactVerificationMethod,
  ContactVerificationRequestDigest,
  ContactVerificationSubjectDigest,
  ContactVerificationTarget,
  ContactVerificationVerifierDigest,
  isContactVerificationChallengeId,
  isContactVerificationCommandId,
  isContactVerificationIdempotencyKey,
  isContactVerificationRequestDigest,
  isContactVerificationSubjectDigest,
  isContactVerificationTarget,
  isContactVerificationVerifierDigest,
} from './contact-verification.contracts';

export const CONTACT_VERIFICATION_CANCEL_REASONS = Object.freeze([
  'user_cancelled',
  'superseded',
  'contact_changed',
  'security_event',
] as const);

export type ContactVerificationCancelReason =
  (typeof CONTACT_VERIFICATION_CANCEL_REASONS)[number];

interface ChallengeCreationBase {
  readonly challengeId: ContactVerificationChallengeId;
  readonly accountId: AccountId;
  readonly contactVersion: number;
  readonly contactValueDigest: ContactVerificationSubjectDigest;
  readonly verifierDigest: ContactVerificationVerifierDigest;
  readonly idempotencyKey: ContactVerificationIdempotencyKey;
  readonly requestDigest: ContactVerificationRequestDigest;
  readonly createdAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
  readonly maxAttempts: number;
}

export type CreateContactVerificationChallengeBinding = ChallengeCreationBase &
  ContactVerificationTarget;

export type ContactVerificationProof = ContactVerificationTarget & {
  readonly challengeId: ContactVerificationChallengeId;
  readonly accountId: AccountId;
  readonly contactVersion: number;
  readonly contactValueDigest: ContactVerificationSubjectDigest;
  readonly verifiedAt: UnixEpochSeconds;
  readonly commandId: ContactVerificationCommandId;
};

export type ContactVerificationAppliedResult =
  | Readonly<{
      type: 'verified';
      proof: ContactVerificationProof;
    }>
  | Readonly<{
      type: 'incorrect_proof';
      attemptsRemaining: number;
    }>
  | Readonly<{
      type: 'resend_reserved';
      dispatchId: InternalUuid;
      rateLimitDecisionId: InternalUuid;
      reservedAt: UnixEpochSeconds;
    }>
  | Readonly<{
      type: 'attempts_exhausted';
      exhaustedAt: UnixEpochSeconds;
      commandId: ContactVerificationCommandId;
    }>
  | Readonly<{
      type: 'expired';
      expiredAt: UnixEpochSeconds;
      commandId: ContactVerificationCommandId;
    }>
  | Readonly<{
      type: 'cancelled';
      cancelledAt: UnixEpochSeconds;
      commandId: ContactVerificationCommandId;
      reason: ContactVerificationCancelReason;
    }>;

interface AppliedCommandBase {
  readonly challengeId: ContactVerificationChallengeId;
  readonly commandId: ContactVerificationCommandId;
  readonly requestDigest: ContactVerificationRequestDigest;
  readonly appliedAt: UnixEpochSeconds;
  readonly result: ContactVerificationAppliedResult;
}

export type AppliedContactVerificationCommand =
  | (AppliedCommandBase & {
      readonly type: 'submit_proof';
      readonly presentedDigest: ContactVerificationVerifierDigest;
    })
  | (AppliedCommandBase & { readonly type: 'expire' })
  | (AppliedCommandBase & {
      readonly type: 'reserve_resend';
      readonly idempotencyKey: ContactVerificationIdempotencyKey;
      readonly dispatchId: InternalUuid;
      readonly rateLimitDecisionId: InternalUuid;
    })
  | (AppliedCommandBase & {
      readonly type: 'cancel';
      readonly reason: ContactVerificationCancelReason;
    });

type ChallengeStateBinding = CreateContactVerificationChallengeBinding & {
  readonly attemptsRemaining: number;
  readonly lastDispatchAt: UnixEpochSeconds;
  readonly resendCount: number;
  readonly appliedCommands: readonly AppliedContactVerificationCommand[];
};

export type ContactVerificationChallengeState =
  | (ChallengeStateBinding & { readonly status: 'pending' })
  | (ChallengeStateBinding & {
      readonly status: 'verified';
      readonly proof: ContactVerificationProof;
    })
  | (ChallengeStateBinding & {
      readonly status: 'expired';
      readonly expiredAt: UnixEpochSeconds;
    })
  | (ChallengeStateBinding & {
      readonly status: 'attempts_exhausted';
      readonly exhaustedAt: UnixEpochSeconds;
    })
  | (ChallengeStateBinding & {
      readonly status: 'cancelled';
      readonly cancellation: Readonly<{
        reason: ContactVerificationCancelReason;
        cancelledAt: UnixEpochSeconds;
      }>;
    });

interface CommandBase {
  readonly challengeId: ContactVerificationChallengeId;
  readonly commandId: ContactVerificationCommandId;
  readonly requestDigest: ContactVerificationRequestDigest;
  readonly now: UnixEpochSeconds;
}

export interface SubmitContactVerificationProofCommand extends CommandBase {
  readonly type: 'submit_proof';
  readonly presentedDigest: ContactVerificationVerifierDigest;
}

export interface ExpireContactVerificationChallengeCommand extends CommandBase {
  readonly type: 'expire';
}

export interface ReserveContactVerificationResendCommand extends CommandBase {
  readonly type: 'reserve_resend';
  /** Resend re-delivers the current proof and never rotates verifierDigest. */
  readonly idempotencyKey: ContactVerificationIdempotencyKey;
  readonly dispatchId: InternalUuid;
  readonly rateLimitDecisionId: InternalUuid;
}

export interface CancelContactVerificationChallengeCommand extends CommandBase {
  readonly type: 'cancel';
  readonly reason: ContactVerificationCancelReason;
}

export type ContactVerificationCommand =
  | SubmitContactVerificationProofCommand
  | ExpireContactVerificationChallengeCommand
  | ReserveContactVerificationResendCommand
  | CancelContactVerificationChallengeCommand;

export type CreateContactVerificationChallengeResult =
  | Readonly<{
      outcome: 'created';
      state: Extract<ContactVerificationChallengeState, { status: 'pending' }>;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason:
        | 'invalid_binding_shape'
        | 'invalid_challenge_id'
        | 'invalid_account_id'
        | 'invalid_field_or_method'
        | 'field_method_mismatch'
        | 'invalid_contact_version'
        | 'invalid_contact_digest'
        | 'invalid_verifier_digest'
        | 'invalid_idempotency_key'
        | 'invalid_request_digest'
        | 'invalid_created_at'
        | 'invalid_expires_at'
        | 'invalid_expiry_window'
        | 'invalid_attempt_budget';
    }>;

export type ContactVerificationTransitionResult =
  | Readonly<{
      outcome: 'transitioned';
      transition:
        | 'verified'
        | 'incorrect_proof'
        | 'resend_reserved'
        | 'attempts_exhausted'
        | 'expired'
        | 'cancelled';
      state: ContactVerificationChallengeState;
      result: ContactVerificationAppliedResult;
    }>
  | Readonly<{
      outcome: 'idempotent_retry';
      state: ContactVerificationChallengeState;
      originalResult: ContactVerificationAppliedResult;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason:
        | 'invalid_state'
        | 'invalid_command'
        | 'challenge_binding_conflict'
        | 'command_reuse_conflict'
        | 'command_time_regression'
        | 'forbidden_transition'
        | 'not_yet_expired'
        | 'resend_cooldown';
      state: ContactVerificationChallengeState;
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isAttemptBudget(value: unknown): value is number {
  return isPositiveInteger(value) && value <= MAX_CONTACT_VERIFICATION_ATTEMPTS;
}

function isCancelReason(
  value: unknown,
): value is ContactVerificationCancelReason {
  return (
    typeof value === 'string' &&
    (CONTACT_VERIFICATION_CANCEL_REASONS as readonly string[]).includes(value)
  );
}

function isKnownField(value: unknown): value is ContactVerificationField {
  return value === 'phone' || value === 'email';
}

function isKnownMethod(value: unknown): value is ContactVerificationMethod {
  return (
    value === 'phone_sms_otp' ||
    value === 'email_code' ||
    value === 'email_link'
  );
}

function immutableTarget(
  field: ContactVerificationField,
  method: ContactVerificationMethod,
): ContactVerificationTarget {
  if (!isContactVerificationTarget(field, method)) {
    throw new TypeError('Contact verification target is invalid');
  }
  return Object.freeze({ field, method }) as ContactVerificationTarget;
}

function immutableProof(
  state: ChallengeStateBinding,
  commandId: ContactVerificationCommandId,
  verifiedAt: UnixEpochSeconds,
): ContactVerificationProof {
  return Object.freeze({
    ...immutableTarget(state.field, state.method),
    challengeId: state.challengeId,
    accountId: state.accountId,
    contactVersion: state.contactVersion,
    contactValueDigest: state.contactValueDigest,
    verifiedAt,
    commandId,
  });
}

function immutableResult(
  result: ContactVerificationAppliedResult,
): ContactVerificationAppliedResult {
  if (result.type === 'verified') {
    return Object.freeze({
      ...result,
      proof: Object.freeze({ ...result.proof }),
    });
  }
  return Object.freeze({ ...result });
}

function immutableAppliedCommand(
  command: AppliedContactVerificationCommand,
): AppliedContactVerificationCommand {
  return Object.freeze({
    ...command,
    result: immutableResult(command.result),
  });
}

function immutableState<State extends ContactVerificationChallengeState>(
  state: State,
): State {
  const appliedCommands = Object.freeze(
    state.appliedCommands.map(immutableAppliedCommand),
  );
  if (state.status === 'verified') {
    return Object.freeze({
      ...state,
      proof: Object.freeze({ ...state.proof }),
      appliedCommands,
    }) as unknown as State;
  }
  if (state.status === 'cancelled') {
    return Object.freeze({
      ...state,
      cancellation: Object.freeze({ ...state.cancellation }),
      appliedCommands,
    }) as unknown as State;
  }
  return Object.freeze({ ...state, appliedCommands }) as unknown as State;
}

function appendCommand(
  state: ChallengeStateBinding,
  command: AppliedContactVerificationCommand,
): readonly AppliedContactVerificationCommand[] {
  return Object.freeze([
    ...state.appliedCommands,
    immutableAppliedCommand(command),
  ]);
}

function commandShapeIsValid(
  value: unknown,
): value is ContactVerificationCommand {
  if (
    !isRecord(value) ||
    !isContactVerificationChallengeId(value.challengeId) ||
    !isContactVerificationCommandId(value.commandId) ||
    !isContactVerificationRequestDigest(value.requestDigest) ||
    !isUnixEpochSeconds(value.now)
  ) {
    return false;
  }
  switch (value.type) {
    case 'submit_proof':
      return (
        hasExactlyKeys(value, [
          'type',
          'challengeId',
          'commandId',
          'requestDigest',
          'presentedDigest',
          'now',
        ]) && isContactVerificationVerifierDigest(value.presentedDigest)
      );
    case 'expire':
      return hasExactlyKeys(value, [
        'type',
        'challengeId',
        'commandId',
        'requestDigest',
        'now',
      ]);
    case 'reserve_resend':
      return (
        hasExactlyKeys(value, [
          'type',
          'challengeId',
          'commandId',
          'requestDigest',
          'now',
          'idempotencyKey',
          'dispatchId',
          'rateLimitDecisionId',
        ]) &&
        isContactVerificationIdempotencyKey(value.idempotencyKey) &&
        isInternalUuid(value.dispatchId) &&
        isInternalUuid(value.rateLimitDecisionId)
      );
    case 'cancel':
      return (
        hasExactlyKeys(value, [
          'type',
          'challengeId',
          'commandId',
          'requestDigest',
          'now',
          'reason',
        ]) && isCancelReason(value.reason)
      );
    default:
      return false;
  }
}

function appliedResultIsValid(
  value: unknown,
): value is ContactVerificationAppliedResult {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'verified':
      return (
        hasExactlyKeys(value, ['type', 'proof']) && proofIsValid(value.proof)
      );
    case 'incorrect_proof':
      return (
        hasExactlyKeys(value, ['type', 'attemptsRemaining']) &&
        typeof value.attemptsRemaining === 'number' &&
        Number.isSafeInteger(value.attemptsRemaining) &&
        value.attemptsRemaining > 0 &&
        value.attemptsRemaining <= MAX_CONTACT_VERIFICATION_ATTEMPTS
      );
    case 'resend_reserved':
      return (
        hasExactlyKeys(value, [
          'type',
          'dispatchId',
          'rateLimitDecisionId',
          'reservedAt',
        ]) &&
        isInternalUuid(value.dispatchId) &&
        isInternalUuid(value.rateLimitDecisionId) &&
        isUnixEpochSeconds(value.reservedAt)
      );
    case 'attempts_exhausted':
      return (
        hasExactlyKeys(value, ['type', 'exhaustedAt', 'commandId']) &&
        isUnixEpochSeconds(value.exhaustedAt) &&
        isContactVerificationCommandId(value.commandId)
      );
    case 'expired':
      return (
        hasExactlyKeys(value, ['type', 'expiredAt', 'commandId']) &&
        isUnixEpochSeconds(value.expiredAt) &&
        isContactVerificationCommandId(value.commandId)
      );
    case 'cancelled':
      return (
        hasExactlyKeys(value, ['type', 'cancelledAt', 'commandId', 'reason']) &&
        isUnixEpochSeconds(value.cancelledAt) &&
        isContactVerificationCommandId(value.commandId) &&
        isCancelReason(value.reason)
      );
    default:
      return false;
  }
}

function proofIsValid(value: unknown): value is ContactVerificationProof {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, [
      'field',
      'method',
      'challengeId',
      'accountId',
      'contactVersion',
      'contactValueDigest',
      'verifiedAt',
      'commandId',
    ]) &&
    isContactVerificationTarget(value.field, value.method) &&
    isContactVerificationChallengeId(value.challengeId) &&
    isAccountId(value.accountId) &&
    isPositiveInteger(value.contactVersion) &&
    isContactVerificationSubjectDigest(value.contactValueDigest) &&
    isUnixEpochSeconds(value.verifiedAt) &&
    isContactVerificationCommandId(value.commandId)
  );
}

function appliedCommandIsValid(
  value: unknown,
  challengeId: ContactVerificationChallengeId,
): value is AppliedContactVerificationCommand {
  if (
    !isRecord(value) ||
    value.challengeId !== challengeId ||
    !isContactVerificationCommandId(value.commandId) ||
    !isContactVerificationRequestDigest(value.requestDigest) ||
    !isUnixEpochSeconds(value.appliedAt) ||
    !appliedResultIsValid(value.result)
  ) {
    return false;
  }
  switch (value.type) {
    case 'submit_proof':
      return (
        hasExactlyKeys(value, [
          'type',
          'challengeId',
          'commandId',
          'requestDigest',
          'appliedAt',
          'presentedDigest',
          'result',
        ]) &&
        isContactVerificationVerifierDigest(value.presentedDigest) &&
        (value.result.type === 'verified' ||
          value.result.type === 'incorrect_proof' ||
          value.result.type === 'attempts_exhausted' ||
          value.result.type === 'expired') &&
        (!('commandId' in value.result) ||
          value.result.commandId === value.commandId) &&
        (value.result.type !== 'verified' ||
          value.result.proof.commandId === value.commandId)
      );
    case 'expire':
      return (
        hasExactlyKeys(value, [
          'type',
          'challengeId',
          'commandId',
          'requestDigest',
          'appliedAt',
          'result',
        ]) &&
        value.result.type === 'expired' &&
        value.result.commandId === value.commandId
      );
    case 'reserve_resend':
      return (
        hasExactlyKeys(value, [
          'type',
          'challengeId',
          'commandId',
          'requestDigest',
          'appliedAt',
          'idempotencyKey',
          'dispatchId',
          'rateLimitDecisionId',
          'result',
        ]) &&
        isContactVerificationIdempotencyKey(value.idempotencyKey) &&
        isInternalUuid(value.dispatchId) &&
        isInternalUuid(value.rateLimitDecisionId) &&
        (value.result.type === 'resend_reserved' ||
          value.result.type === 'expired') &&
        (value.result.type !== 'resend_reserved' ||
          (value.result.dispatchId === value.dispatchId &&
            value.result.rateLimitDecisionId === value.rateLimitDecisionId &&
            value.result.reservedAt === value.appliedAt)) &&
        (value.result.type !== 'expired' ||
          value.result.commandId === value.commandId)
      );
    case 'cancel':
      return (
        hasExactlyKeys(value, [
          'type',
          'challengeId',
          'commandId',
          'requestDigest',
          'appliedAt',
          'reason',
          'result',
        ]) &&
        isCancelReason(value.reason) &&
        (value.result.type === 'cancelled' ||
          value.result.type === 'expired') &&
        value.result.commandId === value.commandId &&
        (value.result.type !== 'cancelled' ||
          value.result.reason === value.reason)
      );
    default:
      return false;
  }
}

function methodPolicyAllows(
  method: ContactVerificationMethod,
  ttlSeconds: number,
  maxAttempts: number,
): boolean {
  const policy = DEFAULT_CONTACT_VERIFICATION_POLICY[method];
  return ttlSeconds <= policy.ttlSeconds && maxAttempts <= policy.maxAttempts;
}

function proofsEqual(
  left: ContactVerificationProof,
  right: ContactVerificationProof,
): boolean {
  return (
    left.challengeId === right.challengeId &&
    left.accountId === right.accountId &&
    left.field === right.field &&
    left.method === right.method &&
    left.contactVersion === right.contactVersion &&
    left.contactValueDigest === right.contactValueDigest &&
    left.verifiedAt === right.verifiedAt &&
    left.commandId === right.commandId
  );
}

function proofMatchesBinding(
  proof: ContactVerificationProof,
  state: ChallengeStateBinding,
  command: AppliedContactVerificationCommand,
): boolean {
  return (
    proof.challengeId === state.challengeId &&
    proof.accountId === state.accountId &&
    proof.field === state.field &&
    proof.method === state.method &&
    proof.contactVersion === state.contactVersion &&
    proof.contactValueDigest === state.contactValueDigest &&
    proof.verifiedAt === command.appliedAt &&
    proof.commandId === command.commandId
  );
}

interface ValidatedHistoryProjection {
  readonly lastResult: ContactVerificationAppliedResult | undefined;
}

function validateAppliedHistory(
  state: ChallengeStateBinding,
): ValidatedHistoryProjection | undefined {
  let attemptsRemaining = state.maxAttempts;
  let previousAppliedAt = state.createdAt;
  let lastDispatchAt = state.createdAt;
  let resendCount = 0;
  const resendKeys = new Set<ContactVerificationIdempotencyKey>();
  const dispatchIds = new Set<InternalUuid>();
  const rateLimitDecisionIds = new Set<InternalUuid>();

  for (const [index, command] of state.appliedCommands.entries()) {
    if (
      command.appliedAt < state.createdAt ||
      command.appliedAt < previousAppliedAt
    ) {
      return undefined;
    }
    previousAppliedAt = command.appliedAt;
    const isLast = index === state.appliedCommands.length - 1;

    switch (command.result.type) {
      case 'resend_reserved':
        if (
          command.type !== 'reserve_resend' ||
          command.appliedAt >= state.expiresAt ||
          command.appliedAt - lastDispatchAt <
            DEFAULT_CONTACT_VERIFICATION_POLICY.resendCooldownSeconds ||
          resendKeys.has(command.idempotencyKey) ||
          dispatchIds.has(command.dispatchId) ||
          rateLimitDecisionIds.has(command.rateLimitDecisionId)
        ) {
          return undefined;
        }
        resendKeys.add(command.idempotencyKey);
        dispatchIds.add(command.dispatchId);
        rateLimitDecisionIds.add(command.rateLimitDecisionId);
        lastDispatchAt = command.appliedAt;
        resendCount += 1;
        break;
      case 'incorrect_proof':
        attemptsRemaining -= 1;
        if (
          command.type !== 'submit_proof' ||
          command.appliedAt >= state.expiresAt ||
          command.presentedDigest === state.verifierDigest ||
          attemptsRemaining <= 0 ||
          command.result.attemptsRemaining !== attemptsRemaining
        ) {
          return undefined;
        }
        break;
      case 'attempts_exhausted':
        attemptsRemaining -= 1;
        if (
          !isLast ||
          command.type !== 'submit_proof' ||
          command.appliedAt >= state.expiresAt ||
          command.presentedDigest === state.verifierDigest ||
          attemptsRemaining !== 0 ||
          command.result.exhaustedAt !== command.appliedAt
        ) {
          return undefined;
        }
        break;
      case 'verified':
        if (
          !isLast ||
          command.type !== 'submit_proof' ||
          command.appliedAt >= state.expiresAt ||
          command.presentedDigest !== state.verifierDigest ||
          !proofMatchesBinding(command.result.proof, state, command)
        ) {
          return undefined;
        }
        break;
      case 'expired':
        if (
          !isLast ||
          command.appliedAt < state.expiresAt ||
          command.result.expiredAt !== command.appliedAt
        ) {
          return undefined;
        }
        break;
      case 'cancelled':
        if (
          !isLast ||
          command.type !== 'cancel' ||
          command.appliedAt >= state.expiresAt ||
          command.result.cancelledAt !== command.appliedAt ||
          command.result.reason !== command.reason
        ) {
          return undefined;
        }
        break;
    }
  }

  if (
    attemptsRemaining !== state.attemptsRemaining ||
    lastDispatchAt !== state.lastDispatchAt ||
    resendCount !== state.resendCount
  ) {
    return undefined;
  }
  return {
    lastResult: state.appliedCommands.at(-1)?.result,
  };
}

function challengeStateIsValid(
  value: unknown,
): value is ContactVerificationChallengeState {
  if (
    !isRecord(value) ||
    !isContactVerificationChallengeId(value.challengeId) ||
    !isAccountId(value.accountId) ||
    !isKnownField(value.field) ||
    !isKnownMethod(value.method) ||
    !isContactVerificationTarget(value.field, value.method) ||
    !isPositiveInteger(value.contactVersion) ||
    !isContactVerificationSubjectDigest(value.contactValueDigest) ||
    !isContactVerificationVerifierDigest(value.verifierDigest) ||
    !isContactVerificationIdempotencyKey(value.idempotencyKey) ||
    !isContactVerificationRequestDigest(value.requestDigest) ||
    !isUnixEpochSeconds(value.createdAt) ||
    !isUnixEpochSeconds(value.expiresAt) ||
    value.expiresAt <= value.createdAt ||
    value.expiresAt - value.createdAt > MAX_CONTACT_VERIFICATION_TTL_SECONDS ||
    !isAttemptBudget(value.maxAttempts) ||
    !methodPolicyAllows(
      value.method,
      value.expiresAt - value.createdAt,
      value.maxAttempts,
    ) ||
    typeof value.attemptsRemaining !== 'number' ||
    !Number.isSafeInteger(value.attemptsRemaining) ||
    value.attemptsRemaining < 0 ||
    value.attemptsRemaining > value.maxAttempts ||
    !isUnixEpochSeconds(value.lastDispatchAt) ||
    typeof value.resendCount !== 'number' ||
    !Number.isSafeInteger(value.resendCount) ||
    value.resendCount < 0 ||
    !Array.isArray(value.appliedCommands) ||
    value.appliedCommands.some(
      (command) =>
        !appliedCommandIsValid(
          command,
          value.challengeId as ContactVerificationChallengeId,
        ),
    )
  ) {
    return false;
  }
  const ids = value.appliedCommands.map((command) => command.commandId);
  if (new Set(ids).size !== ids.length) return false;
  const history = validateAppliedHistory(
    value as unknown as ChallengeStateBinding,
  );
  if (history === undefined) return false;
  const { lastResult } = history;

  const baseKeys = [
    'challengeId',
    'accountId',
    'field',
    'method',
    'contactVersion',
    'contactValueDigest',
    'verifierDigest',
    'idempotencyKey',
    'requestDigest',
    'createdAt',
    'expiresAt',
    'maxAttempts',
    'attemptsRemaining',
    'lastDispatchAt',
    'resendCount',
    'appliedCommands',
    'status',
  ];
  switch (value.status) {
    case 'pending':
      return (
        hasExactlyKeys(value, baseKeys) &&
        value.attemptsRemaining > 0 &&
        (lastResult === undefined ||
          lastResult.type === 'incorrect_proof' ||
          lastResult.type === 'resend_reserved')
      );
    case 'verified':
      return (
        hasExactlyKeys(value, [...baseKeys, 'proof']) &&
        proofIsValid(value.proof) &&
        value.proof.challengeId === value.challengeId &&
        value.proof.accountId === value.accountId &&
        value.proof.field === value.field &&
        value.proof.method === value.method &&
        value.proof.contactVersion === value.contactVersion &&
        value.proof.contactValueDigest === value.contactValueDigest &&
        isUnixEpochSeconds(value.proof.verifiedAt) &&
        isContactVerificationCommandId(value.proof.commandId) &&
        lastResult?.type === 'verified' &&
        proofsEqual(lastResult.proof, value.proof)
      );
    case 'expired':
      return (
        hasExactlyKeys(value, [...baseKeys, 'expiredAt']) &&
        isUnixEpochSeconds(value.expiredAt) &&
        lastResult?.type === 'expired' &&
        lastResult.expiredAt === value.expiredAt
      );
    case 'attempts_exhausted':
      return (
        hasExactlyKeys(value, [...baseKeys, 'exhaustedAt']) &&
        value.attemptsRemaining === 0 &&
        isUnixEpochSeconds(value.exhaustedAt) &&
        lastResult?.type === 'attempts_exhausted' &&
        lastResult.exhaustedAt === value.exhaustedAt
      );
    case 'cancelled':
      return (
        hasExactlyKeys(value, [...baseKeys, 'cancellation']) &&
        isRecord(value.cancellation) &&
        hasExactlyKeys(value.cancellation, ['reason', 'cancelledAt']) &&
        isCancelReason(value.cancellation.reason) &&
        isUnixEpochSeconds(value.cancellation.cancelledAt) &&
        lastResult?.type === 'cancelled' &&
        lastResult.reason === value.cancellation.reason &&
        lastResult.cancelledAt === value.cancellation.cancelledAt
      );
    default:
      return false;
  }
}

export function createContactVerificationChallenge(
  input: unknown,
): CreateContactVerificationChallengeResult {
  if (!isRecord(input)) {
    return { outcome: 'rejected', reason: 'invalid_binding_shape' };
  }
  if (
    !hasExactlyKeys(input, [
      'challengeId',
      'accountId',
      'field',
      'method',
      'contactVersion',
      'contactValueDigest',
      'verifierDigest',
      'idempotencyKey',
      'requestDigest',
      'createdAt',
      'expiresAt',
      'maxAttempts',
    ])
  ) {
    return { outcome: 'rejected', reason: 'invalid_binding_shape' };
  }
  if (!isContactVerificationChallengeId(input.challengeId)) {
    return { outcome: 'rejected', reason: 'invalid_challenge_id' };
  }
  if (!isAccountId(input.accountId)) {
    return { outcome: 'rejected', reason: 'invalid_account_id' };
  }
  if (!isKnownField(input.field) || !isKnownMethod(input.method)) {
    return { outcome: 'rejected', reason: 'invalid_field_or_method' };
  }
  if (!isContactVerificationTarget(input.field, input.method)) {
    return { outcome: 'rejected', reason: 'field_method_mismatch' };
  }
  if (!isPositiveInteger(input.contactVersion)) {
    return { outcome: 'rejected', reason: 'invalid_contact_version' };
  }
  if (!isContactVerificationSubjectDigest(input.contactValueDigest)) {
    return { outcome: 'rejected', reason: 'invalid_contact_digest' };
  }
  if (!isContactVerificationVerifierDigest(input.verifierDigest)) {
    return { outcome: 'rejected', reason: 'invalid_verifier_digest' };
  }
  if (!isContactVerificationIdempotencyKey(input.idempotencyKey)) {
    return { outcome: 'rejected', reason: 'invalid_idempotency_key' };
  }
  if (!isContactVerificationRequestDigest(input.requestDigest)) {
    return { outcome: 'rejected', reason: 'invalid_request_digest' };
  }
  if (!isUnixEpochSeconds(input.createdAt)) {
    return { outcome: 'rejected', reason: 'invalid_created_at' };
  }
  if (!isUnixEpochSeconds(input.expiresAt)) {
    return { outcome: 'rejected', reason: 'invalid_expires_at' };
  }
  if (
    input.expiresAt <= input.createdAt ||
    input.expiresAt - input.createdAt > MAX_CONTACT_VERIFICATION_TTL_SECONDS ||
    input.expiresAt - input.createdAt >
      DEFAULT_CONTACT_VERIFICATION_POLICY[input.method].ttlSeconds
  ) {
    return { outcome: 'rejected', reason: 'invalid_expiry_window' };
  }
  if (
    !isAttemptBudget(input.maxAttempts) ||
    input.maxAttempts >
      DEFAULT_CONTACT_VERIFICATION_POLICY[input.method].maxAttempts
  ) {
    return { outcome: 'rejected', reason: 'invalid_attempt_budget' };
  }

  const target = immutableTarget(input.field, input.method);
  const state = immutableState({
    ...target,
    challengeId: input.challengeId,
    accountId: input.accountId,
    contactVersion: input.contactVersion,
    contactValueDigest: input.contactValueDigest,
    verifierDigest: input.verifierDigest,
    idempotencyKey: input.idempotencyKey,
    requestDigest: input.requestDigest,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    maxAttempts: input.maxAttempts,
    attemptsRemaining: input.maxAttempts,
    lastDispatchAt: input.createdAt,
    resendCount: 0,
    appliedCommands: Object.freeze([]),
    status: 'pending',
  });
  return Object.freeze({ outcome: 'created', state });
}

function sameAppliedCommand(
  applied: AppliedContactVerificationCommand,
  command: ContactVerificationCommand,
): boolean {
  if (
    applied.type !== command.type ||
    applied.challengeId !== command.challengeId ||
    applied.commandId !== command.commandId ||
    applied.requestDigest !== command.requestDigest
  ) {
    return false;
  }
  if (applied.type === 'submit_proof' && command.type === 'submit_proof') {
    return applied.presentedDigest === command.presentedDigest;
  }
  if (applied.type === 'cancel' && command.type === 'cancel') {
    return applied.reason === command.reason;
  }
  if (applied.type === 'reserve_resend' && command.type === 'reserve_resend') {
    return (
      applied.idempotencyKey === command.idempotencyKey &&
      applied.dispatchId === command.dispatchId &&
      applied.rateLimitDecisionId === command.rateLimitDecisionId
    );
  }
  return true;
}

function digestsEqual(
  left: ContactVerificationVerifierDigest,
  right: ContactVerificationVerifierDigest,
): boolean {
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function rejected(
  state: ContactVerificationChallengeState,
  reason: Extract<
    ContactVerificationTransitionResult,
    { outcome: 'rejected' }
  >['reason'],
): ContactVerificationTransitionResult {
  return Object.freeze({ outcome: 'rejected', reason, state });
}

function transitioned(
  state: ContactVerificationChallengeState,
  transition: Extract<
    ContactVerificationTransitionResult,
    { outcome: 'transitioned' }
  >['transition'],
  result: ContactVerificationAppliedResult,
): ContactVerificationTransitionResult {
  return Object.freeze({
    outcome: 'transitioned',
    transition,
    state,
    result: immutableResult(result),
  });
}

function expireFromCommand(
  state: ChallengeStateBinding,
  command: ContactVerificationCommand,
): ContactVerificationTransitionResult {
  const result = Object.freeze({
    type: 'expired' as const,
    expiredAt: command.now,
    commandId: command.commandId,
  });
  const applied = immutableAppliedCommand({
    type: command.type,
    challengeId: command.challengeId,
    commandId: command.commandId,
    requestDigest: command.requestDigest,
    appliedAt: command.now,
    ...(command.type === 'submit_proof'
      ? { presentedDigest: command.presentedDigest }
      : command.type === 'cancel'
        ? { reason: command.reason }
        : command.type === 'reserve_resend'
          ? {
              idempotencyKey: command.idempotencyKey,
              dispatchId: command.dispatchId,
              rateLimitDecisionId: command.rateLimitDecisionId,
            }
          : {}),
    result,
  } as AppliedContactVerificationCommand);
  const next = immutableState({
    ...state,
    status: 'expired',
    expiredAt: command.now,
    appliedCommands: appendCommand(state, applied),
  });
  return transitioned(next, 'expired', result);
}

export function transitionContactVerificationChallenge(
  state: ContactVerificationChallengeState,
  command: unknown,
): ContactVerificationTransitionResult {
  if (!challengeStateIsValid(state)) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'invalid_state',
      state,
    });
  }
  if (!commandShapeIsValid(command)) {
    return rejected(state, 'invalid_command');
  }
  if (command.challengeId !== state.challengeId) {
    return rejected(state, 'challenge_binding_conflict');
  }

  if (command.type === 'reserve_resend') {
    const previousResend = state.appliedCommands.find(
      (applied) =>
        applied.type === 'reserve_resend' &&
        applied.idempotencyKey === command.idempotencyKey,
    );
    if (previousResend !== undefined) {
      return previousResend.requestDigest === command.requestDigest
        ? Object.freeze({
            outcome: 'idempotent_retry',
            state,
            originalResult: previousResend.result,
          })
        : rejected(state, 'command_reuse_conflict');
    }
  }

  const previous = state.appliedCommands.find(
    (applied) => applied.commandId === command.commandId,
  );
  if (previous !== undefined) {
    return sameAppliedCommand(previous, command)
      ? Object.freeze({
          outcome: 'idempotent_retry',
          state,
          originalResult: previous.result,
        })
      : rejected(state, 'command_reuse_conflict');
  }
  const lastAppliedAt =
    state.appliedCommands.at(-1)?.appliedAt ?? state.createdAt;
  if (command.now < lastAppliedAt) {
    return rejected(state, 'command_time_regression');
  }
  if (state.status !== 'pending') {
    return rejected(state, 'forbidden_transition');
  }

  if (command.type === 'expire') {
    return command.now < state.expiresAt
      ? rejected(state, 'not_yet_expired')
      : expireFromCommand(state, command);
  }
  if (command.now >= state.expiresAt) {
    return expireFromCommand(state, command);
  }
  if (command.type === 'cancel') {
    const result = Object.freeze({
      type: 'cancelled' as const,
      cancelledAt: command.now,
      commandId: command.commandId,
      reason: command.reason,
    });
    const applied = immutableAppliedCommand({
      type: 'cancel',
      challengeId: command.challengeId,
      commandId: command.commandId,
      requestDigest: command.requestDigest,
      appliedAt: command.now,
      reason: command.reason,
      result,
    });
    const next = immutableState({
      ...state,
      status: 'cancelled',
      cancellation: Object.freeze({
        reason: command.reason,
        cancelledAt: command.now,
      }),
      appliedCommands: appendCommand(state, applied),
    });
    return transitioned(next, 'cancelled', result);
  }

  if (command.type === 'reserve_resend') {
    if (
      command.now - state.lastDispatchAt <
      DEFAULT_CONTACT_VERIFICATION_POLICY.resendCooldownSeconds
    ) {
      return rejected(state, 'resend_cooldown');
    }
    const result = Object.freeze({
      type: 'resend_reserved' as const,
      dispatchId: command.dispatchId,
      rateLimitDecisionId: command.rateLimitDecisionId,
      reservedAt: command.now,
    });
    const applied = immutableAppliedCommand({
      type: 'reserve_resend',
      challengeId: command.challengeId,
      commandId: command.commandId,
      requestDigest: command.requestDigest,
      appliedAt: command.now,
      idempotencyKey: command.idempotencyKey,
      dispatchId: command.dispatchId,
      rateLimitDecisionId: command.rateLimitDecisionId,
      result,
    });
    const next = immutableState({
      ...state,
      lastDispatchAt: command.now,
      resendCount: state.resendCount + 1,
      appliedCommands: appendCommand(state, applied),
    });
    return transitioned(next, 'resend_reserved', result);
  }

  if (digestsEqual(command.presentedDigest, state.verifierDigest)) {
    const proof = immutableProof(state, command.commandId, command.now);
    const result = Object.freeze({ type: 'verified' as const, proof });
    const applied = immutableAppliedCommand({
      type: 'submit_proof',
      challengeId: command.challengeId,
      commandId: command.commandId,
      requestDigest: command.requestDigest,
      appliedAt: command.now,
      presentedDigest: command.presentedDigest,
      result,
    });
    const next = immutableState({
      ...state,
      status: 'verified',
      proof,
      appliedCommands: appendCommand(state, applied),
    });
    return transitioned(next, 'verified', result);
  }

  const attemptsRemaining = state.attemptsRemaining - 1;
  if (attemptsRemaining === 0) {
    const result = Object.freeze({
      type: 'attempts_exhausted' as const,
      exhaustedAt: command.now,
      commandId: command.commandId,
    });
    const applied = immutableAppliedCommand({
      type: 'submit_proof',
      challengeId: command.challengeId,
      commandId: command.commandId,
      requestDigest: command.requestDigest,
      appliedAt: command.now,
      presentedDigest: command.presentedDigest,
      result,
    });
    const next = immutableState({
      ...state,
      status: 'attempts_exhausted',
      attemptsRemaining,
      exhaustedAt: command.now,
      appliedCommands: appendCommand(state, applied),
    });
    return transitioned(next, 'attempts_exhausted', result);
  }

  const result = Object.freeze({
    type: 'incorrect_proof' as const,
    attemptsRemaining,
  });
  const applied = immutableAppliedCommand({
    type: 'submit_proof',
    challengeId: command.challengeId,
    commandId: command.commandId,
    requestDigest: command.requestDigest,
    appliedAt: command.now,
    presentedDigest: command.presentedDigest,
    result,
  });
  const next = immutableState({
    ...state,
    attemptsRemaining,
    appliedCommands: appendCommand(state, applied),
  });
  return transitioned(next, 'incorrect_proof', result);
}

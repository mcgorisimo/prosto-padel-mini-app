import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  ContactVerificationChallengeId,
  ContactVerificationCommandId,
  contactVerificationIdempotencyKey,
  contactVerificationRequestDigest,
  contactVerificationSubjectDigest,
  contactVerificationVerifierDigest,
} from './contact-verification.contracts';
import {
  AppliedContactVerificationCommand,
  CONTACT_VERIFICATION_CANCEL_REASONS,
  CancelContactVerificationChallengeCommand,
  ContactVerificationAppliedResult,
  ContactVerificationChallengeState,
  ContactVerificationCommand,
  ContactVerificationTransitionResult,
  CreateContactVerificationChallengeBinding,
  CreateContactVerificationChallengeResult,
  ExpireContactVerificationChallengeCommand,
  ReserveContactVerificationResendCommand,
  SubmitContactVerificationProofCommand,
  createContactVerificationChallenge,
  transitionContactVerificationChallenge,
} from './contact-verification.state-machine';

const ACCOUNT_ID = deterministicUuid('contact-account') as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'other-contact-account',
) as AccountId;
const CREATED_AT = unixEpochSeconds(1_787_500_000);
const BEFORE_EXPIRY = unixEpochSeconds(1_787_500_299);
const EXPIRES_AT = unixEpochSeconds(1_787_500_300);
const AFTER_EXPIRY = unixEpochSeconds(1_787_500_301);
const CONTACT_DIGEST = contactVerificationSubjectDigest('a'.repeat(64));
const VERIFIER_DIGEST = contactVerificationVerifierDigest('b'.repeat(64));
const WRONG_DIGEST = contactVerificationVerifierDigest('c'.repeat(64));
const OTHER_DIGEST = contactVerificationVerifierDigest('d'.repeat(64));
const CREATE_REQUEST_DIGEST = contactVerificationRequestDigest('e'.repeat(64));
const COMMAND_REQUEST_DIGEST = contactVerificationRequestDigest('f'.repeat(64));

function challengeId(
  value = 'contact-challenge',
): ContactVerificationChallengeId {
  return deterministicUuid(value) as ContactVerificationChallengeId;
}

function commandId(value = 'contact-command'): ContactVerificationCommandId {
  return deterministicUuid(value) as ContactVerificationCommandId;
}

function binding(
  overrides: Partial<CreateContactVerificationChallengeBinding> = {},
): CreateContactVerificationChallengeBinding {
  return {
    challengeId: challengeId(),
    accountId: ACCOUNT_ID,
    field: 'phone',
    method: 'phone_sms_otp',
    contactVersion: 1,
    contactValueDigest: CONTACT_DIGEST,
    verifierDigest: VERIFIER_DIGEST,
    idempotencyKey: contactVerificationIdempotencyKey('start-request-1'),
    requestDigest: CREATE_REQUEST_DIGEST,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    maxAttempts: 3,
    ...overrides,
  } as CreateContactVerificationChallengeBinding;
}

function pending(
  overrides: Partial<CreateContactVerificationChallengeBinding> = {},
): Extract<ContactVerificationChallengeState, { status: 'pending' }> {
  const result: CreateContactVerificationChallengeResult =
    createContactVerificationChallenge(binding(overrides));
  if (result.outcome !== 'created') {
    throw new Error(`Expected pending challenge: ${result.reason}`);
  }
  return result.state;
}

function expire(
  state: ContactVerificationChallengeState,
  overrides: Partial<ExpireContactVerificationChallengeCommand> = {},
): ExpireContactVerificationChallengeCommand {
  return {
    type: 'expire',
    challengeId: state.challengeId,
    commandId: commandId('expire-command'),
    requestDigest: COMMAND_REQUEST_DIGEST,
    now: EXPIRES_AT,
    ...overrides,
  };
}

function cancel(
  state: ContactVerificationChallengeState,
  overrides: Partial<CancelContactVerificationChallengeCommand> = {},
): CancelContactVerificationChallengeCommand {
  return {
    type: 'cancel',
    challengeId: state.challengeId,
    commandId: commandId('cancel-command'),
    requestDigest: COMMAND_REQUEST_DIGEST,
    now: BEFORE_EXPIRY,
    reason: 'user_cancelled',
    ...overrides,
  };
}

function submit(
  state: ContactVerificationChallengeState,
  overrides: Partial<SubmitContactVerificationProofCommand> = {},
): SubmitContactVerificationProofCommand {
  return {
    type: 'submit_proof',
    challengeId: state.challengeId,
    commandId: commandId(),
    requestDigest: COMMAND_REQUEST_DIGEST,
    presentedDigest: VERIFIER_DIGEST,
    now: BEFORE_EXPIRY,
    ...overrides,
  };
}

function reserveResend(
  state: ContactVerificationChallengeState,
  overrides: Partial<ReserveContactVerificationResendCommand> = {},
): ReserveContactVerificationResendCommand {
  return {
    type: 'reserve_resend',
    challengeId: state.challengeId,
    commandId: commandId('resend-command'),
    requestDigest: contactVerificationRequestDigest('2'.repeat(64)),
    now: unixEpochSeconds(CREATED_AT + 60),
    idempotencyKey: contactVerificationIdempotencyKey('resend-request-1'),
    dispatchId: deterministicUuid('resend-dispatch'),
    rateLimitDecisionId: deterministicUuid('resend-rate-decision'),
    ...overrides,
  };
}

describe('contact verification challenge creation', () => {
  it.each([
    ['phone', 'phone_sms_otp'],
    ['email', 'email_code'],
    ['email', 'email_link'],
  ] as const)('creates a distinct %s / %s challenge', (field, method) => {
    const result = createContactVerificationChallenge(
      binding({
        field,
        method,
      } as Partial<CreateContactVerificationChallengeBinding>),
    );

    expect(result).toMatchObject({
      outcome: 'created',
      state: {
        field,
        method,
        status: 'pending',
        attemptsRemaining: 3,
      },
    });
  });

  it.each([
    ['phone', 'email_code'],
    ['phone', 'email_link'],
    ['email', 'phone_sms_otp'],
  ] as const)(
    'rejects crossed field/method binding %s / %s',
    (field, method) => {
      expect(
        createContactVerificationChallenge(
          binding({
            field,
            method,
          } as Partial<CreateContactVerificationChallengeBinding>),
        ),
      ).toEqual({ outcome: 'rejected', reason: 'field_method_mismatch' });
    },
  );

  it('rejects unknown fields carrying raw contact, proof or provider data', () => {
    expect(
      createContactVerificationChallenge({
        ...binding(),
        phone: '+79990000000',
        email: 'player@example.com',
        plaintextCode: '123456',
        provider: 'some-sms-vendor',
      } as unknown as CreateContactVerificationChallengeBinding),
    ).toEqual({ outcome: 'rejected', reason: 'invalid_binding_shape' });
  });

  it('rejects invalid account, version, TTL and attempt budgets', () => {
    const cases: readonly Partial<CreateContactVerificationChallengeBinding>[] =
      [
        { accountId: 'account' as AccountId },
        { accountId: OTHER_ACCOUNT_ID, contactVersion: 0 },
        { expiresAt: CREATED_AT },
        { expiresAt: unixEpochSeconds(CREATED_AT + 601) },
        { expiresAt: unixEpochSeconds(CREATED_AT + 86_401) },
        { maxAttempts: 0 },
        { maxAttempts: 6 },
        { maxAttempts: 11 },
      ];

    for (const change of cases) {
      expect(createContactVerificationChallenge(binding(change))).toMatchObject(
        {
          outcome: 'rejected',
        },
      );
    }
  });
});

describe('contact verification attempts, expiry and idempotency', () => {
  it('creates a field-bound proof without auth, rating or payment meaning', () => {
    const state = pending();
    const result = transitionContactVerificationChallenge(state, submit(state));

    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'verified',
      state: {
        status: 'verified',
        proof: {
          accountId: ACCOUNT_ID,
          field: 'phone',
          method: 'phone_sms_otp',
          contactVersion: 1,
          contactValueDigest: CONTACT_DIGEST,
          verifiedAt: BEFORE_EXPIRY,
        },
      },
    });
    if (result.outcome !== 'transitioned') return;
    if (result.state.status !== 'verified') {
      throw new Error('Expected verified contact proof');
    }
    for (const forbidden of [
      'isVerified',
      'rating',
      'paymentStatus',
      'ownerPaid',
      'providerPaymentId',
      'destination',
      'plaintextCode',
    ]) {
      expect(result.state).not.toHaveProperty(forbidden);
      expect(result.state.proof).not.toHaveProperty(forbidden);
    }
  });

  it('supports email link proof as an email-only state', () => {
    const state = pending({ field: 'email', method: 'email_link' });
    const result = transitionContactVerificationChallenge(state, submit(state));

    expect(result).toMatchObject({
      outcome: 'transitioned',
      state: {
        status: 'verified',
        proof: { field: 'email', method: 'email_link' },
      },
    });
  });

  it('decrements an incorrect proof exactly once', () => {
    const state = pending();
    const command = submit(state, { presentedDigest: WRONG_DIGEST });
    const first = transitionContactVerificationChallenge(state, command);
    expect(first).toMatchObject({
      outcome: 'transitioned',
      transition: 'incorrect_proof',
      state: { status: 'pending', attemptsRemaining: 2 },
    });
    if (first.outcome !== 'transitioned') return;

    const retry = transitionContactVerificationChallenge(first.state, {
      ...command,
      now: AFTER_EXPIRY,
    });
    expect(retry).toMatchObject({
      outcome: 'idempotent_retry',
      originalResult: { type: 'incorrect_proof', attemptsRemaining: 2 },
      state: { attemptsRemaining: 2 },
    });
  });

  it('rejects command-ID reuse with changed protected input', () => {
    const state = pending();
    const command = submit(state, { presentedDigest: WRONG_DIGEST });
    const first = transitionContactVerificationChallenge(state, command);
    if (first.outcome !== 'transitioned') {
      throw new Error('Expected first incorrect proof');
    }

    expect(
      transitionContactVerificationChallenge(first.state, {
        ...command,
        presentedDigest: OTHER_DIGEST,
      }),
    ).toMatchObject({ outcome: 'rejected', reason: 'command_reuse_conflict' });
  });

  it('rejects a new submit timestamped before challenge creation', () => {
    const state = pending();
    expect(
      transitionContactVerificationChallenge(
        state,
        submit(state, {
          commandId: commandId('pre-creation-submit'),
          now: unixEpochSeconds(CREATED_AT - 1),
        }),
      ),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'command_time_regression',
    });
  });

  it('rejects a new cancel timestamped before the latest applied command', () => {
    const state = pending();
    const resend = transitionContactVerificationChallenge(
      state,
      reserveResend(state, { now: unixEpochSeconds(CREATED_AT + 120) }),
    );
    if (resend.outcome !== 'transitioned') {
      throw new Error('Expected resend reservation');
    }

    expect(
      transitionContactVerificationChallenge(
        resend.state,
        cancel(resend.state, {
          commandId: commandId('regressed-cancel'),
          now: unixEpochSeconds(CREATED_AT + 119),
        }),
      ),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'command_time_regression',
    });
  });

  it('reserves one resend after cooldown without resetting attempts', () => {
    const state = pending();
    const firstWrong = transitionContactVerificationChallenge(
      state,
      submit(state, {
        commandId: commandId('wrong-before-resend'),
        presentedDigest: WRONG_DIGEST,
        now: unixEpochSeconds(CREATED_AT + 30),
      }),
    );
    if (firstWrong.outcome !== 'transitioned') {
      throw new Error('Expected first incorrect proof');
    }

    const result = transitionContactVerificationChallenge(
      firstWrong.state,
      reserveResend(firstWrong.state),
    );
    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'resend_reserved',
      state: {
        status: 'pending',
        verifierDigest: VERIFIER_DIGEST,
        attemptsRemaining: 2,
        lastDispatchAt: CREATED_AT + 60,
        resendCount: 1,
      },
      result: {
        type: 'resend_reserved',
        dispatchId: deterministicUuid('resend-dispatch'),
        rateLimitDecisionId: deterministicUuid('resend-rate-decision'),
        reservedAt: CREATED_AT + 60,
      },
    });
  });

  it('rejects resend-side verifier rotation', () => {
    const state = pending();
    expect(
      transitionContactVerificationChallenge(state, {
        ...reserveResend(state),
        verifierDigest: OTHER_DIGEST,
      }),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'invalid_command',
      state: { verifierDigest: VERIFIER_DIGEST, resendCount: 0 },
    });
  });

  it('rejects resend before cooldown without consuming an attempt', () => {
    const state = pending();
    expect(
      transitionContactVerificationChallenge(
        state,
        reserveResend(state, {
          now: unixEpochSeconds(CREATED_AT + 59),
        }),
      ),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'resend_cooldown',
      state: { attemptsRemaining: 3, resendCount: 0 },
    });
  });

  it('returns the original resend reservation for an exact idempotency retry', () => {
    const state = pending();
    const command = reserveResend(state);
    const first = transitionContactVerificationChallenge(state, command);
    if (first.outcome !== 'transitioned') {
      throw new Error('Expected resend reservation');
    }

    const retry = transitionContactVerificationChallenge(
      first.state,
      reserveResend(first.state, {
        commandId: commandId('retry-resend-command'),
        dispatchId: deterministicUuid('candidate-retry-dispatch'),
        rateLimitDecisionId: deterministicUuid('candidate-rate-decision'),
        now: unixEpochSeconds(CREATED_AT + 120),
      }),
    );
    expect(retry).toMatchObject({
      outcome: 'idempotent_retry',
      originalResult: {
        type: 'resend_reserved',
        dispatchId: command.dispatchId,
        rateLimitDecisionId: command.rateLimitDecisionId,
        reservedAt: command.now,
      },
      state: { resendCount: 1 },
    });
    expect(retry.state.appliedCommands).toHaveLength(1);
  });

  it('rejects resend idempotency-key reuse with a changed request digest', () => {
    const state = pending();
    const first = transitionContactVerificationChallenge(
      state,
      reserveResend(state),
    );
    if (first.outcome !== 'transitioned') {
      throw new Error('Expected resend reservation');
    }

    expect(
      transitionContactVerificationChallenge(
        first.state,
        reserveResend(first.state, {
          requestDigest: contactVerificationRequestDigest('3'.repeat(64)),
          commandId: commandId('conflicting-resend-command'),
          now: unixEpochSeconds(CREATED_AT + 120),
        }),
      ),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'command_reuse_conflict',
      state: { resendCount: 1 },
    });
  });

  it('expires instead of reserving a resend at the deadline', () => {
    const state = pending();
    expect(
      transitionContactVerificationChallenge(
        state,
        reserveResend(state, { now: EXPIRES_AT }),
      ),
    ).toMatchObject({
      outcome: 'transitioned',
      transition: 'expired',
      state: { status: 'expired', resendCount: 0 },
    });
  });

  it('moves the final incorrect proof to attempts_exhausted', () => {
    const state = pending({ maxAttempts: 1 });
    expect(
      transitionContactVerificationChallenge(
        state,
        submit(state, { presentedDigest: WRONG_DIGEST }),
      ),
    ).toMatchObject({
      outcome: 'transitioned',
      transition: 'attempts_exhausted',
      state: { status: 'attempts_exhausted', attemptsRemaining: 0 },
    });
  });

  it('expires at the exact deadline and cannot become verified', () => {
    const state = pending();
    expect(
      transitionContactVerificationChallenge(
        state,
        submit(state, { now: EXPIRES_AT }),
      ),
    ).toMatchObject({
      outcome: 'transitioned',
      transition: 'expired',
      state: { status: 'expired' },
    });
  });

  it('rejects early expiry and expires idempotently at the deadline', () => {
    const state = pending();
    const early: ContactVerificationCommand = expire(state, {
      now: BEFORE_EXPIRY,
    });
    expect(transitionContactVerificationChallenge(state, early)).toMatchObject({
      outcome: 'rejected',
      reason: 'not_yet_expired',
    });

    const command = expire(state);
    const first: ContactVerificationTransitionResult =
      transitionContactVerificationChallenge(state, command);
    expect(first).toMatchObject({
      outcome: 'transitioned',
      transition: 'expired',
    });
    if (first.outcome !== 'transitioned') return;
    expect(
      transitionContactVerificationChallenge(first.state, command),
    ).toMatchObject({ outcome: 'idempotent_retry' });
  });

  it.each(CONTACT_VERIFICATION_CANCEL_REASONS)(
    'cancels with allowlisted reason %s and preserves its applied result',
    (reason) => {
      const state = pending();
      const result = transitionContactVerificationChallenge(
        state,
        cancel(state, { reason }),
      );
      expect(result).toMatchObject({
        outcome: 'transitioned',
        transition: 'cancelled',
        state: { status: 'cancelled', cancellation: { reason } },
      });
      if (result.outcome !== 'transitioned') return;
      const applied: AppliedContactVerificationCommand =
        result.state.appliedCommands[0];
      const appliedResult: ContactVerificationAppliedResult = applied.result;
      expect(appliedResult).toMatchObject({ type: 'cancelled', reason });
    },
  );

  it('never serializes raw contact values or plaintext proof material', () => {
    const state = pending();
    const serialized = JSON.stringify(
      transitionContactVerificationChallenge(
        state,
        submit(state, { presentedDigest: WRONG_DIGEST }),
      ),
    );
    expect(serialized).not.toContain('+79990000000');
    expect(serialized).not.toContain('player@example.com');
    expect(serialized).not.toContain('123456');
    expect(serialized).not.toContain('opaque-random-token');
  });

  it('keeps creation idempotency binding immutable in later states', () => {
    const idempotencyKey = contactVerificationIdempotencyKey('immutable-start');
    const requestDigest = contactVerificationRequestDigest('1'.repeat(64));
    const state = pending({ idempotencyKey, requestDigest });
    const result = transitionContactVerificationChallenge(state, submit(state));
    expect(result).toMatchObject({
      state: { idempotencyKey, requestDigest },
    });
  });

  it('rejects a hydrated state with inconsistent attempt counters', () => {
    const state = pending();
    const malformed = {
      ...state,
      attemptsRemaining: 2,
    } as unknown as ContactVerificationChallengeState;

    expect(
      transitionContactVerificationChallenge(
        malformed,
        submit(malformed, { commandId: commandId('malformed-state') }),
      ),
    ).toMatchObject({ outcome: 'rejected', reason: 'invalid_state' });
  });

  it.each([
    {
      label: 'method attempt budget',
      changes: { maxAttempts: 6, attemptsRemaining: 6 },
    },
    {
      label: 'method expiry window',
      changes: { expiresAt: unixEpochSeconds(CREATED_AT + 601) },
    },
  ])('rejects a hydrated state with inflated $label', ({ changes }) => {
    const state = pending();
    const malformed = {
      ...state,
      ...changes,
    } as unknown as ContactVerificationChallengeState;

    expect(
      transitionContactVerificationChallenge(
        malformed,
        submit(malformed, { commandId: commandId('inflated-policy') }),
      ),
    ).toMatchObject({ outcome: 'rejected', reason: 'invalid_state' });
  });

  it('rejects a hydrated applied proof forged for another account', () => {
    const initial = pending();
    const verified = transitionContactVerificationChallenge(
      initial,
      submit(initial),
    );
    if (
      verified.outcome !== 'transitioned' ||
      verified.state.status !== 'verified'
    ) {
      throw new Error('Expected verified state');
    }
    const applied = verified.state.appliedCommands[0];
    if (applied.result.type !== 'verified') {
      throw new Error('Expected applied verified result');
    }
    const malformed = {
      ...verified.state,
      appliedCommands: [
        {
          ...applied,
          result: {
            ...applied.result,
            proof: { ...applied.result.proof, accountId: OTHER_ACCOUNT_ID },
          },
        },
      ],
    } as unknown as ContactVerificationChallengeState;

    expect(
      transitionContactVerificationChallenge(
        malformed,
        submit(malformed, { commandId: commandId('forged-history-proof') }),
      ),
    ).toMatchObject({ outcome: 'rejected', reason: 'invalid_state' });
  });

  it('rejects a hydrated history revived after a terminal result', () => {
    const initial = pending();
    const verified = transitionContactVerificationChallenge(
      initial,
      submit(initial),
    );
    const wrong = transitionContactVerificationChallenge(
      initial,
      submit(initial, {
        commandId: commandId('wrong-after-terminal'),
        presentedDigest: WRONG_DIGEST,
      }),
    );
    if (
      verified.outcome !== 'transitioned' ||
      wrong.outcome !== 'transitioned'
    ) {
      throw new Error('Expected terminal and pending histories');
    }
    const malformed = {
      ...wrong.state,
      appliedCommands: [
        ...verified.state.appliedCommands,
        ...wrong.state.appliedCommands,
      ],
    } as unknown as ContactVerificationChallengeState;

    expect(
      transitionContactVerificationChallenge(
        malformed,
        submit(malformed, { commandId: commandId('revived-history') }),
      ),
    ).toMatchObject({ outcome: 'rejected', reason: 'invalid_state' });
  });

  it('rejects PII or provider fields injected into a hydrated proof', () => {
    const initial = pending();
    const verified = transitionContactVerificationChallenge(
      initial,
      submit(initial),
    );
    if (
      verified.outcome !== 'transitioned' ||
      verified.state.status !== 'verified'
    ) {
      throw new Error('Expected verified state');
    }
    const malformed = {
      ...verified.state,
      proof: {
        ...verified.state.proof,
        destination: 'player@example.com',
        providerResponse: { id: 'provider-message' },
      },
    } as unknown as ContactVerificationChallengeState;

    expect(
      transitionContactVerificationChallenge(
        malformed,
        submit(malformed, { commandId: commandId('proof-injection') }),
      ),
    ).toMatchObject({ outcome: 'rejected', reason: 'invalid_state' });
  });
});

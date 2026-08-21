import { isAccountId } from '../accounts/account.types';
import {
  PlayerOnboardingReadPersistenceError,
  PlayerOnboardingReader,
  PlayerOnboardingRecord,
} from '../database/player-onboarding-reader';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  OwnPlayerOnboarding,
  ReadOwnPlayerOnboardingInput,
  ReadOwnPlayerOnboardingResult,
  isOwnPlayerOnboarding,
  isReadOwnPlayerOnboardingInput,
} from './player-onboarding.types';

export interface PlayerOnboardingTransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PlayerOnboardingServiceDependencies {
  readonly transactions: PlayerOnboardingTransactionExecutor;
  readonly onboarding: PlayerOnboardingReader;
}

type RejectionReason = Extract<
  ReadOwnPlayerOnboardingResult,
  { readonly outcome: 'rejected' }
>['reason'];

function rejected<Reason extends RejectionReason>(
  reason: Reason,
): Readonly<{ readonly outcome: 'rejected'; readonly reason: Reason }> {
  return Object.freeze({ outcome: 'rejected', reason });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
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

function copyConsents(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return Object.freeze(
    value.map((consent) =>
      isPlainRecord(consent) &&
      hasExactlyKeys(consent, ['kind', 'documentVersion'])
        ? Object.freeze({
            kind: consent.kind,
            documentVersion: consent.documentVersion,
          })
        : consent,
    ),
  );
}

function copyAnswers(value: unknown): unknown {
  return isPlainRecord(value) ? Object.freeze({ ...value }) : value;
}

function publicOnboarding(
  value: unknown,
  expectedAccountId: ReadOwnPlayerOnboardingInput['accountId'],
): OwnPlayerOnboarding | undefined {
  if (
    !isPlainRecord(value) ||
    !hasExactlyKeys(value, [
      'accountId',
      'firstName',
      'lastName',
      'phone',
      'normalizedEmail',
      'state',
      'consents',
    ]) ||
    !isAccountId(value.accountId) ||
    value.accountId !== expectedAccountId
  ) {
    return undefined;
  }

  let candidate: unknown;
  if (value.state === null) {
    candidate = {
      status: 'required',
      flowVersion: null,
      currentStep: 'profile',
      surveyVersion: null,
      revision: null,
      profile: {
        firstName: value.firstName,
        lastName: value.lastName,
      },
      contacts: {
        phone: value.phone,
        normalizedEmail: value.normalizedEmail,
        assurance: 'declared',
      },
      consents: copyConsents(value.consents),
      surveyAnswers: Object.freeze({}),
    };
  } else if (
    isPlainRecord(value.state) &&
    hasExactlyKeys(value.state, [
      'flowVersion',
      'status',
      'currentStep',
      'surveyVersion',
      'surveyAnswers',
      'revision',
    ])
  ) {
    candidate = {
      status: value.state.status,
      flowVersion: value.state.flowVersion,
      currentStep: value.state.currentStep,
      surveyVersion: value.state.surveyVersion,
      revision: value.state.revision,
      profile: {
        firstName: value.firstName,
        lastName: value.lastName,
      },
      contacts: {
        phone: value.phone,
        normalizedEmail: value.normalizedEmail,
        assurance: 'declared',
      },
      consents: copyConsents(value.consents),
      surveyAnswers: copyAnswers(value.state.surveyAnswers),
    };
  } else {
    return undefined;
  }

  if (!isOwnPlayerOnboarding(candidate)) {
    return undefined;
  }
  const onboarding = candidate as OwnPlayerOnboarding;
  return Object.freeze({
    ...onboarding,
    profile: Object.freeze({ ...onboarding.profile }),
    contacts: Object.freeze({ ...onboarding.contacts }),
    consents: onboarding.consents,
    surveyAnswers: onboarding.surveyAnswers,
  });
}

function temporaryStorageFailure(error: unknown): boolean {
  return (
    error instanceof PlayerOnboardingReadPersistenceError &&
    (error.reason === 'database_unavailable' ||
      error.reason === 'transaction_conflict')
  );
}

export class PlayerOnboardingService {
  constructor(readonly dependencies: PlayerOnboardingServiceDependencies) {}

  async readOwnOnboarding(
    input: ReadOwnPlayerOnboardingInput,
  ): Promise<ReadOwnPlayerOnboardingResult> {
    if (!isReadOwnPlayerOnboardingInput(input)) {
      return rejected('invalid_request');
    }
    if (input.role !== 'player') {
      return rejected('onboarding_not_found');
    }

    try {
      const result = await this.dependencies.transactions.run((transaction) =>
        this.dependencies.onboarding.findByAccountId(transaction, {
          accountId: input.accountId,
        }),
      );
      if (
        isPlainRecord(result) &&
        hasExactlyKeys(result, ['outcome']) &&
        result.outcome === 'not_found'
      ) {
        return rejected('onboarding_not_found');
      }
      if (
        !isPlainRecord(result) ||
        !hasExactlyKeys(result, ['outcome', 'onboarding']) ||
        result.outcome !== 'found'
      ) {
        return rejected('internal_failure');
      }

      const onboarding = publicOnboarding(
        result.onboarding as PlayerOnboardingRecord,
        input.accountId,
      );
      if (onboarding === undefined) {
        return rejected('internal_failure');
      }
      return Object.freeze({ outcome: 'found', onboarding });
    } catch (error) {
      return rejected(
        temporaryStorageFailure(error)
          ? 'temporary_unavailable'
          : 'internal_failure',
      );
    }
  }
}

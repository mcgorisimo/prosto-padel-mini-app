import { isAccountId } from '../accounts/account.types';
import { isUserGeneratedTextAllowed } from '../common/content-moderation';
import {
  PlayerOnboardingDraftWritePersistenceError,
  PlayerOnboardingDraftWriter,
  SavePlayerOnboardingDraftResult,
} from '../database/player-onboarding-draft-writer';
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
  SaveOwnPlayerOnboardingDraftInput,
  SaveOwnPlayerOnboardingDraftResult,
  isOwnPlayerOnboarding,
  isReadOwnPlayerOnboardingInput,
  isSaveOwnPlayerOnboardingDraftInput,
} from './player-onboarding.types';
import { SessionAuthenticationClock } from './session-authentication.guard';

export interface PlayerOnboardingTransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PlayerOnboardingServiceDependencies {
  readonly transactions: PlayerOnboardingTransactionExecutor;
  readonly onboarding: PlayerOnboardingReader;
  readonly draftWriter: PlayerOnboardingDraftWriter;
  readonly clock: SessionAuthenticationClock;
}

type RejectionReason = Extract<
  ReadOwnPlayerOnboardingResult | SaveOwnPlayerOnboardingDraftResult,
  { readonly outcome: 'rejected' }
>['reason'];

type DraftTransactionResult =
  | Exclude<SavePlayerOnboardingDraftResult, { readonly outcome: 'saved' }>
  | Extract<SaveOwnPlayerOnboardingDraftResult, { readonly outcome: 'saved' }>;

const ONBOARDING_FLOW_VERSION = 'tma_v1';
const ONBOARDING_SURVEY_VERSION = 'initial_level_v1';
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/u;

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
    (error instanceof PlayerOnboardingReadPersistenceError ||
      error instanceof PlayerOnboardingDraftWritePersistenceError) &&
    (error.reason === 'database_unavailable' ||
      error.reason === 'transaction_conflict')
  );
}

function normalizeEmail(value: string | null): string | null | undefined {
  if (value === null) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 320 && EMAIL_PATTERN.test(normalized)
    ? normalized
    : undefined;
}

function containsDisallowedName(
  input: SaveOwnPlayerOnboardingDraftInput,
): boolean {
  return (
    !isUserGeneratedTextAllowed(input.draft.profile.firstName) ||
    (input.draft.profile.lastName !== null &&
      !isUserGeneratedTextAllowed(input.draft.profile.lastName))
  );
}

function storageInvariantFailure(): PlayerOnboardingDraftWritePersistenceError {
  return new PlayerOnboardingDraftWritePersistenceError(
    'invalid_persisted_state',
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

  async saveOwnOnboardingDraft(
    input: SaveOwnPlayerOnboardingDraftInput,
  ): Promise<SaveOwnPlayerOnboardingDraftResult> {
    if (!isSaveOwnPlayerOnboardingDraftInput(input)) {
      return rejected('invalid_request');
    }
    if (input.role !== 'player') {
      return rejected('onboarding_not_found');
    }
    const normalizedEmail = normalizeEmail(input.draft.contacts.email);
    if (normalizedEmail === undefined) {
      return rejected('invalid_request');
    }
    if (containsDisallowedName(input)) {
      return rejected('content_not_allowed');
    }

    try {
      const result =
        await this.dependencies.transactions.run<DraftTransactionResult>(
          async (transaction) => {
            const saved = await this.dependencies.draftWriter.saveDraft(
              transaction,
              {
                accountId: input.accountId,
                expectedRevision: input.draft.expectedRevision,
                firstName: input.draft.profile.firstName,
                lastName: input.draft.profile.lastName,
                phone: input.draft.contacts.phone,
                normalizedEmail,
                flowVersion: ONBOARDING_FLOW_VERSION,
                surveyVersion: ONBOARDING_SURVEY_VERSION,
                updatedAt: this.dependencies.clock.nowEpochSeconds(),
              },
            );
            if (saved.outcome !== 'saved') {
              return saved;
            }

            const reread = await this.dependencies.onboarding.findByAccountId(
              transaction,
              { accountId: input.accountId },
            );
            if (reread.outcome !== 'found') {
              throw storageInvariantFailure();
            }
            const onboarding = publicOnboarding(
              reread.onboarding as PlayerOnboardingRecord,
              input.accountId,
            );
            if (
              onboarding === undefined ||
              onboarding.status !== 'in_progress' ||
              onboarding.revision !== saved.revision
            ) {
              throw storageInvariantFailure();
            }
            return Object.freeze({ outcome: 'saved', onboarding });
          },
        );

      switch (result.outcome) {
        case 'saved':
          return result;
        case 'not_found':
          return rejected('onboarding_not_found');
        case 'stale_revision':
          return rejected('stale_revision');
        case 'closed':
          return rejected('onboarding_closed');
      }
    } catch (error) {
      return rejected(
        temporaryStorageFailure(error)
          ? 'temporary_unavailable'
          : 'internal_failure',
      );
    }
  }
}

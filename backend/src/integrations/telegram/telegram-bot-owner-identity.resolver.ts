import { AccountId } from '../../accounts/account.types';
import {
  ExternalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from '../../accounts/external-identity.types';
import {
  externalIdentityLookupDigestPepperVersion,
  externalIdentityLookupDigestVersion,
} from '../../accounts/external-identity-lookup-digest.port';
import { TelegramLookupDigestCandidatesAdapter } from '../../auth/telegram-lookup-digest.adapter';
import { AccountStatusReader } from '../../auth/telegram-login.ports';
import { ExternalIdentityResolutionRepository } from '../../database/external-identity.repository';
import { PostgresTransaction } from '../../database/postgres-transaction';

export interface MatchTelegramBotOwnerInput {
  readonly telegramChatId: string;
  readonly allowedAccountId: AccountId;
}

export abstract class TelegramBotOwnerIdentityResolver {
  abstract matches(
    transaction: PostgresTransaction,
    input: MatchTelegramBotOwnerInput,
  ): Promise<boolean>;
}

export class DisabledTelegramBotOwnerIdentityResolver extends TelegramBotOwnerIdentityResolver {
  async matches(): Promise<boolean> {
    return false;
  }
}

export class VerifiedTelegramBotOwnerIdentityResolver extends TelegramBotOwnerIdentityResolver {
  constructor(
    private readonly namespace: ExternalIdentityNamespace,
    private readonly digests: TelegramLookupDigestCandidatesAdapter,
    private readonly identities: ExternalIdentityResolutionRepository,
    private readonly accounts: AccountStatusReader,
  ) {
    super();
  }

  async matches(
    transaction: PostgresTransaction,
    input: MatchTelegramBotOwnerInput,
  ): Promise<boolean> {
    const digest = await this.digests.compute({
      provider: 'telegram',
      namespace: this.namespace,
      canonicalSubject: trustProviderCanonicalizedExternalIdentitySubject(
        input.telegramChatId,
      ),
      digestVersion: externalIdentityLookupDigestVersion(1),
      pepperVersion: externalIdentityLookupDigestPepperVersion(1),
    });
    const identity = await this.identities.resolveByLookupDigests(transaction, [
      digest,
    ]);
    if (
      identity.outcome !== 'linked' ||
      identity.identity.provider !== 'telegram' ||
      identity.identity.namespace !== this.namespace ||
      identity.identity.accountId !== input.allowedAccountId
    ) {
      return false;
    }

    const account = await this.accounts.findById(
      transaction,
      input.allowedAccountId,
    );
    return (
      account.outcome === 'found' &&
      account.accountId === input.allowedAccountId &&
      account.status === 'active'
    );
  }
}

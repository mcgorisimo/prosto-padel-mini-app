import { accountId } from '../../accounts/account.types';
import { newExternalIdentityId } from '../../accounts/external-identity-lifecycle.types';
import {
  externalIdentityLookupDigestPepperVersion,
  externalIdentityLookupDigestVersion,
} from '../../accounts/external-identity-lookup-digest.port';
import { externalIdentityNamespace } from '../../accounts/external-identity.types';
import { TelegramLookupDigestCandidatesAdapter } from '../../auth/telegram-lookup-digest.adapter';
import { AccountStatusReader } from '../../auth/telegram-login.ports';
import { ExternalIdentityResolutionRepository } from '../../database/external-identity.repository';
import { PostgresTransaction } from '../../database/postgres-transaction';
import { VerifiedTelegramBotOwnerIdentityResolver } from './telegram-bot-owner-identity.resolver';

const OWNER_ACCOUNT_ID = accountId('11111111-1111-4111-8111-111111111111');
const OTHER_ACCOUNT_ID = accountId('22222222-2222-4222-8222-222222222222');
const NAMESPACE = externalIdentityNamespace('telegram:bot:123456789');
const CHAT_ID = '777888999';

function harness(resolvedAccountId = OWNER_ACCOUNT_ID, status = 'active') {
  const resolveByLookupDigests = jest.fn().mockResolvedValue({
    outcome: 'linked',
    identity: {
      identityId: newExternalIdentityId(),
      accountId: resolvedAccountId,
      provider: 'telegram',
      namespace: NAMESPACE,
      isPrimary: true,
    },
  });
  const findById = jest.fn().mockResolvedValue({
    outcome: 'found',
    accountId: OWNER_ACCOUNT_ID,
    role: 'player',
    status,
  });
  const digests = new TelegramLookupDigestCandidatesAdapter({
    digestVersion: externalIdentityLookupDigestVersion(1),
    pepperVersion: externalIdentityLookupDigestPepperVersion(1),
    pepper: Buffer.alloc(32, 0x45),
  });
  const resolver = new VerifiedTelegramBotOwnerIdentityResolver(
    NAMESPACE,
    digests,
    {
      resolveByLookupDigests,
    } as unknown as ExternalIdentityResolutionRepository,
    { findById } as unknown as AccountStatusReader,
  );
  return { resolver, resolveByLookupDigests, findById };
}

describe('VerifiedTelegramBotOwnerIdentityResolver', () => {
  const transaction = { query: jest.fn() } as unknown as PostgresTransaction;

  it('matches only a linked active allowlisted account using a protected digest', async () => {
    const subject = harness();

    await expect(
      subject.resolver.matches(transaction, {
        telegramChatId: CHAT_ID,
        allowedAccountId: OWNER_ACCOUNT_ID,
      }),
    ).resolves.toBe(true);

    expect(subject.findById).toHaveBeenCalledWith(
      transaction,
      OWNER_ACCOUNT_ID,
    );
    expect(
      JSON.stringify(subject.resolveByLookupDigests.mock.calls),
    ).not.toContain(CHAT_ID);
  });

  it('does not match a different linked account', async () => {
    const subject = harness(OTHER_ACCOUNT_ID);

    await expect(
      subject.resolver.matches(transaction, {
        telegramChatId: CHAT_ID,
        allowedAccountId: OWNER_ACCOUNT_ID,
      }),
    ).resolves.toBe(false);
    expect(subject.findById).not.toHaveBeenCalled();
  });

  it.each(['blocked', 'pending_deletion', 'anonymized'])(
    'does not match an allowlisted account in %s status',
    async (status) => {
      const subject = harness(OWNER_ACCOUNT_ID, status);

      await expect(
        subject.resolver.matches(transaction, {
          telegramChatId: CHAT_ID,
          allowedAccountId: OWNER_ACCOUNT_ID,
        }),
      ).resolves.toBe(false);
    },
  );
});

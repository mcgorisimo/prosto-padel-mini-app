import { UnixEpochSeconds } from '../auth/auth.types';
import { InternalUuid } from '../common/internal-uuid';
import { PostgresTransaction } from './postgres-transaction';

export interface ClaimTelegramBotUpdateInput {
  readonly updateId: number;
  readonly receivedAt: UnixEpochSeconds;
  readonly botNamespace: InternalUuid;
}

export type TelegramBotUpdateIdentity = Readonly<
  Pick<ClaimTelegramBotUpdateInput, 'updateId' | 'botNamespace'>
>;

export type ClaimTelegramBotUpdateOutcome = 'claimed' | 'ignored';

export interface TelegramBotUpdateRepository {
  exists(
    transaction: PostgresTransaction,
    input: TelegramBotUpdateIdentity,
  ): Promise<boolean>;
  claim(
    transaction: PostgresTransaction,
    input: ClaimTelegramBotUpdateInput,
  ): Promise<ClaimTelegramBotUpdateOutcome>;
}

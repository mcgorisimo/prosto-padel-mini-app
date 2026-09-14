import { Injectable } from '@nestjs/common';
import { isUnixEpochSeconds } from '../auth/auth.types';
import { isInternalUuid } from '../common/internal-uuid';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import {
  ClaimTelegramBotUpdateInput,
  ClaimTelegramBotUpdateOutcome,
  TelegramBotUpdateIdentity,
  TelegramBotUpdateRepository,
} from './telegram-bot-update.repository';

export const TELEGRAM_BOT_UPDATE_ID_MAXIMUM = 2_147_483_647;

const MAX_RECEIPTS_PER_BOT = 1_024;

const LOCK_BOT_NAMESPACE_SQL = `
  SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'backend_notification:telegram_bot_update_receipts:' || $1::text,
      0::bigint
    )
  ) AS locked
`;

const CLAIM_UPDATE_SQL = `
  INSERT INTO backend_notification.telegram_bot_update_receipts (
    bot_namespace, update_id, received_at
  )
  VALUES ($3, $1, $2)
  ON CONFLICT (bot_namespace, update_id) DO NOTHING
  RETURNING update_id
`;

const UPDATE_EXISTS_SQL = `
  SELECT EXISTS (
    SELECT 1
    FROM backend_notification.telegram_bot_update_receipts AS receipt
    WHERE receipt.bot_namespace = $2
      AND receipt.update_id = $1
  ) AS update_exists
`;

const TRIM_RECEIPTS_SQL = `
  DELETE FROM backend_notification.telegram_bot_update_receipts AS receipt
  USING (
    SELECT stale.bot_namespace, stale.update_id
    FROM backend_notification.telegram_bot_update_receipts AS stale
    WHERE stale.bot_namespace = $1
    ORDER BY stale.received_at DESC, stale.update_id DESC
    OFFSET $2
  ) AS stale
  WHERE receipt.bot_namespace = stale.bot_namespace
    AND receipt.update_id = stale.update_id
`;

export class TelegramBotUpdatePersistenceError extends Error {
  readonly name = 'TelegramBotUpdatePersistenceError';

  constructor() {
    super('Telegram bot update persistence failed');
  }
}

function validIdentity(value: TelegramBotUpdateIdentity): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Number.isSafeInteger(value.updateId) &&
    value.updateId >= 0 &&
    value.updateId <= TELEGRAM_BOT_UPDATE_ID_MAXIMUM &&
    isInternalUuid(value.botNamespace)
  );
}

function validInput(value: ClaimTelegramBotUpdateInput): boolean {
  return validIdentity(value) && isUnixEpochSeconds(value.receivedAt);
}

@Injectable()
export class PostgresTelegramBotUpdateRepository implements TelegramBotUpdateRepository {
  async exists(
    transaction: PostgresTransaction,
    input: TelegramBotUpdateIdentity,
  ): Promise<boolean> {
    if (!validIdentity(input)) {
      throw new TelegramBotUpdatePersistenceError();
    }

    try {
      await transaction.query(LOCK_BOT_NAMESPACE_SQL, [input.botNamespace]);
      const result = await transaction.query(UPDATE_EXISTS_SQL, [
        input.updateId,
        input.botNamespace,
      ]);
      if (
        result.rowCount !== 1 ||
        result.rows.length !== 1 ||
        typeof result.rows[0]?.update_exists !== 'boolean'
      ) {
        throw new TelegramBotUpdatePersistenceError();
      }
      return result.rows[0].update_exists;
    } catch (error) {
      if (error instanceof TelegramBotUpdatePersistenceError) {
        throw error;
      }
      classifyPostgresError(error);
      throw new TelegramBotUpdatePersistenceError();
    }
  }

  async claim(
    transaction: PostgresTransaction,
    input: ClaimTelegramBotUpdateInput,
  ): Promise<ClaimTelegramBotUpdateOutcome> {
    if (!validInput(input)) {
      throw new TelegramBotUpdatePersistenceError();
    }

    try {
      await transaction.query(LOCK_BOT_NAMESPACE_SQL, [input.botNamespace]);
      const result = await transaction.query(CLAIM_UPDATE_SQL, [
        input.updateId,
        input.receivedAt.toString(10),
        input.botNamespace,
      ]);
      if (result.rowCount === 1 && result.rows.length === 1) {
        await transaction.query(TRIM_RECEIPTS_SQL, [
          input.botNamespace,
          MAX_RECEIPTS_PER_BOT,
        ]);
        return 'claimed';
      }
      if (result.rowCount === 0 && result.rows.length === 0) {
        return 'ignored';
      }
      throw new TelegramBotUpdatePersistenceError();
    } catch (error) {
      if (error instanceof TelegramBotUpdatePersistenceError) {
        throw error;
      }
      classifyPostgresError(error);
      throw new TelegramBotUpdatePersistenceError();
    }
  }
}

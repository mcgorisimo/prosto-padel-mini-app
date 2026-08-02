import { createHash } from 'node:crypto';
import { isAccountId } from '../accounts/account.types';
import { internalUuid, isInternalUuid } from '../common/internal-uuid';
import {
  AdminPlayerRatingPersistenceError,
  AdminPlayerRatingRepository,
  AdminPlayerRecord,
  AdminRatingStateCommandRecord,
} from '../database/admin-player-rating.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  AdminPlayerListResponse,
  AdminPlayerRatingStateResponse,
  ListAdminPlayersApiInput,
  ListAdminPlayersApiResult,
  SetAdminPlayerRatingStateApiInput,
  SetAdminPlayerRatingStateApiResult,
} from './admin-player-rating-api.types';
import { SessionAuthenticationClock } from './session-authentication.guard';
import { isUnixEpochSeconds } from './auth.types';

export interface AdminPlayerRatingTransactionExecutor {
  run<T>(operation: (transaction: PostgresTransaction) => Promise<T>): Promise<T>;
}

export interface AdminPlayerRatingServiceDependencies {
  readonly transactions: AdminPlayerRatingTransactionExecutor;
  readonly ratings: AdminPlayerRatingRepository;
  readonly clock: SessionAuthenticationClock;
}

interface CursorPayload {
  readonly version: 1;
  readonly search: string | null;
  readonly verification: 'all' | 'verified' | 'unverified';
  readonly afterAccountId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejected(reason: Extract<ListAdminPlayersApiResult | SetAdminPlayerRatingStateApiResult, { outcome: 'rejected' }>['reason']) {
  return Object.freeze({ outcome: 'rejected' as const, reason });
}

function validRating(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) return false;
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) <=
    Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
}

function encodeCursor(input: Omit<CursorPayload, 'version'>): string {
  return Buffer.from(JSON.stringify({ version: 1, ...input }), 'utf8').toString('base64url');
}

function decodeCursor(value: string, search: string | undefined, verification: CursorPayload['verification']) {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== value) return undefined;
    const parsed: unknown = JSON.parse(decoded);
    if (
      !isRecord(parsed) || Object.keys(parsed).length !== 4 ||
      parsed.version !== 1 || parsed.search !== (search ?? null) ||
      parsed.verification !== verification || !isAccountId(parsed.afterAccountId)
    ) {
      return undefined;
    }
    return parsed.afterAccountId;
  } catch {
    return undefined;
  }
}

function validListInput(value: unknown): value is ListAdminPlayersApiInput {
  if (!isRecord(value) || Object.keys(value).length !== 3 ||
      !isAccountId(value.accountId) || !['player', 'club_admin'].includes(String(value.role)) ||
      !isRecord(value.request)) return false;
  const request = value.request;
  return Object.keys(request).every((key) => ['search', 'verification', 'cursor', 'limit'].includes(key)) &&
    (request.search === undefined || (typeof request.search === 'string' && request.search.length > 0 &&
      request.search.trim() === request.search && request.search.normalize('NFKC') === request.search &&
      [...request.search].length <= 64 && !/[\u0000-\u001f\u007f-\u009f]/u.test(request.search))) &&
    ['all', 'verified', 'unverified'].includes(String(request.verification)) &&
    (request.cursor === undefined || (typeof request.cursor === 'string' && request.cursor.length > 0 && request.cursor.length <= 1024)) &&
    Number.isInteger(request.limit) && (request.limit as number) >= 1 && (request.limit as number) <= 50;
}

function validSetInput(value: unknown): value is SetAdminPlayerRatingStateApiInput {
  return isRecord(value) && Object.keys(value).length === 4 &&
    isAccountId(value.accountId) && ['player', 'club_admin'].includes(String(value.role)) &&
    isAccountId(value.targetAccountId) && value.targetAccountId !== value.accountId && isRecord(value.request) &&
    Object.keys(value.request).length === 3 &&
    isInternalUuid(value.request.requestKey) && validRating(value.request.rating) &&
    typeof value.request.isVerified === 'boolean';
}

function validPlayer(value: unknown): value is AdminPlayerRecord {
  const bounded = (candidate: unknown, maximum: number) =>
    candidate === undefined ||
    (typeof candidate === 'string' && candidate.length > 0 && [...candidate].length <= maximum);
  if (!isRecord(value) || !isAccountId(value.accountId) ||
      typeof value.firstName !== 'string' || value.firstName.length === 0 || [...value.firstName].length > 256 ||
      !validRating(value.rating) || typeof value.isVerified !== 'boolean') return false;
  return bounded(value.lastName, 256) && bounded(value.username, 64) &&
    bounded(value.phone, 16) &&
    (value.phone === undefined || /^\+[1-9][0-9]{6,14}$/u.test(value.phone as string)) &&
    (value.sidePreference === undefined || ['Left', 'Both', 'Right'].includes(String(value.sidePreference)));
}

function responsePlayer(player: AdminPlayerRecord) {
  return Object.freeze({
    accountId: player.accountId,
    firstName: player.firstName,
    lastName: player.lastName ?? null,
    username: player.username ?? null,
    phone: player.phone ?? null,
    sidePreference: player.sidePreference ?? null,
    rating: player.rating,
    isVerified: player.isVerified,
  });
}

function validCommand(value: unknown): value is AdminRatingStateCommandRecord {
  if (!(isRecord(value) && Object.keys(value).length === 9 &&
    isInternalUuid(value.commandId) && isAccountId(value.actorAccountId) && isAccountId(value.targetAccountId) &&
    ['rating_updated', 'verification_updated', 'rating_and_verification_updated', 'rating_state_unchanged'].includes(String(value.resultType)) &&
    validRating(value.ratingBefore) && validRating(value.ratingAfter) &&
    typeof value.isVerifiedBefore === 'boolean' && typeof value.isVerifiedAfter === 'boolean' &&
    Number.isSafeInteger(value.appliedAt) && (value.appliedAt as number) >= 0)) return false;
  const ratingChanged = value.ratingBefore !== value.ratingAfter;
  const verificationChanged = value.isVerifiedBefore !== value.isVerifiedAfter;
  return value.resultType === (
    ratingChanged && verificationChanged ? 'rating_and_verification_updated'
      : ratingChanged ? 'rating_updated'
        : verificationChanged ? 'verification_updated'
          : 'rating_state_unchanged'
  );
}

function responseState(command: AdminRatingStateCommandRecord): AdminPlayerRatingStateResponse {
  return Object.freeze({
    commandId: command.commandId,
    targetAccountId: command.targetAccountId,
    resultType: command.resultType,
    ratingBefore: command.ratingBefore,
    rating: command.ratingAfter,
    isVerifiedBefore: command.isVerifiedBefore,
    isVerified: command.isVerifiedAfter,
    appliedAt: command.appliedAt,
  });
}

function digest(input: SetAdminPlayerRatingStateApiInput): string {
  return createHash('sha256')
    .update('backend-admin-rating-state:v1\0', 'utf8')
    .update(input.request.requestKey, 'utf8').update('\0')
    .update(input.accountId, 'utf8').update('\0')
    .update(input.targetAccountId, 'utf8').update('\0')
    .update(input.request.rating.toFixed(2), 'utf8').update('\0')
    .update(input.request.isVerified ? 'true' : 'false', 'utf8')
    .digest('hex');
}

function temporary(error: unknown): boolean {
  return error instanceof AdminPlayerRatingPersistenceError &&
    ['database_unavailable', 'transaction_conflict'].includes(error.reason);
}

export class AdminPlayerRatingService {
  constructor(readonly dependencies: AdminPlayerRatingServiceDependencies) {}

  async list(input: ListAdminPlayersApiInput): Promise<ListAdminPlayersApiResult> {
    if (!validListInput(input)) return rejected('invalid_request');
    if (input.role !== 'club_admin') return rejected('forbidden');
    const afterAccountId = input.request.cursor === undefined
      ? undefined
      : decodeCursor(input.request.cursor, input.request.search, input.request.verification);
    if (input.request.cursor !== undefined && afterAccountId === undefined) return rejected('invalid_request');
    try {
      const result = await this.dependencies.transactions.run((transaction) =>
        this.dependencies.ratings.listPlayers(transaction, {
          actorAccountId: input.accountId,
          ...(afterAccountId === undefined ? {} : { afterAccountId }),
          ...(input.request.search === undefined ? {} : { search: input.request.search }),
          verification: input.request.verification,
          limit: input.request.limit,
        }));
      if (result.outcome === 'forbidden') return rejected('forbidden');
      if (result.players.length > input.request.limit || !result.players.every(validPlayer) ||
          new Set(result.players.map((player) => player.accountId)).size !== result.players.length ||
          (result.nextAfterAccountId !== undefined &&
            (result.players.length === 0 || result.nextAfterAccountId !== result.players[result.players.length - 1].accountId))) {
        return rejected('internal_failure');
      }
      const response: AdminPlayerListResponse = Object.freeze({
        players: Object.freeze(result.players.map(responsePlayer)),
        nextCursor: result.nextAfterAccountId === undefined ? null : encodeCursor({
          search: input.request.search ?? null,
          verification: input.request.verification,
          afterAccountId: result.nextAfterAccountId,
        }),
      });
      return Object.freeze({ outcome: 'listed', response });
    } catch (error) {
      return rejected(temporary(error) ? 'temporary_unavailable' : 'internal_failure');
    }
  }

  async setRatingState(input: SetAdminPlayerRatingStateApiInput): Promise<SetAdminPlayerRatingStateApiResult> {
    if (!validSetInput(input)) return rejected('invalid_request');
    if (input.role !== 'club_admin') return rejected('forbidden');
    let appliedAt;
    try {
      appliedAt = this.dependencies.clock.nowEpochSeconds();
    } catch {
      return rejected('internal_failure');
    }
    if (!isUnixEpochSeconds(appliedAt)) return rejected('internal_failure');
    try {
      const result = await this.dependencies.transactions.run((transaction) =>
        this.dependencies.ratings.setRatingState(transaction, {
          commandId: internalUuid(input.request.requestKey),
          actorAccountId: input.accountId,
          targetAccountId: input.targetAccountId,
          requestDigest: digest(input),
          rating: input.request.rating,
          isVerified: input.request.isVerified,
          appliedAt,
        }));
      if (result.outcome !== 'applied') return rejected(result.outcome);
      if (!validCommand(result.command) || result.command.commandId !== input.request.requestKey ||
          result.command.actorAccountId !== input.accountId || result.command.targetAccountId !== input.targetAccountId ||
          result.command.ratingAfter !== input.request.rating ||
          result.command.isVerifiedAfter !== input.request.isVerified) {
        return rejected('internal_failure');
      }
      return Object.freeze({ outcome: 'applied', state: responseState(result.command) });
    } catch (error) {
      return rejected(temporary(error) ? 'temporary_unavailable' : 'internal_failure');
    }
  }
}

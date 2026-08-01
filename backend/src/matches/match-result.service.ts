import { createHash } from 'node:crypto';
import { USER_ROLES, isAccountId } from '../accounts/account.types';
import { encodeLengthPrefixedUtf8, uuidV5FromParts } from '../auth/crypto-encoding';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../auth/auth.types';
import {
  MatchResultPersistenceError,
  MatchResultRejection,
  MatchResultRepository,
} from '../database/match-result.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  MatchResultApiActor,
  MatchResultApiRejection,
  MatchResultResponse,
  MutateMatchResultApiResult,
  ReadMatchResultApiInput,
  ReadMatchResultApiResult,
  ResolveMatchResultApiInput,
  SubmitMatchResultApiInput,
} from './match-result-api.types';
import {
  MatchResultCommandId,
  MatchResultId,
  MatchResultRequestDigest,
  MatchResultSetRecord,
  isMatchResultRequestDigest,
} from './match-result.types';
import { isMatchId } from './match.types';

const UUID_URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const REQUEST_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DOMAINS = Object.freeze({
  submit: Object.freeze({
    command: 'prosto-padel.match-result.submit.command.v1',
    result: 'prosto-padel.match-result.submit.result.v1',
    request: 'prosto-padel.match-result.submit.request.v1',
  }),
  confirm: Object.freeze({
    command: 'prosto-padel.match-result.confirm.command.v1',
    request: 'prosto-padel.match-result.confirm.request.v1',
  }),
  dispute: Object.freeze({
    command: 'prosto-padel.match-result.dispute.command.v1',
    request: 'prosto-padel.match-result.dispute.request.v1',
  }),
});

export interface MatchResultTransactionExecutor {
  run<T>(operation: (transaction: PostgresTransaction) => Promise<T>): Promise<T>;
}

export interface MatchResultServiceDependencies {
  readonly transactions: MatchResultTransactionExecutor;
  readonly results: MatchResultRepository;
  readonly clock: { nowEpochSeconds(): UnixEpochSeconds };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  return actual.length === expected.length && expected.every((key) =>
    Object.prototype.hasOwnProperty.call(record, key),
  );
}

function validActor(value: unknown): value is MatchResultApiActor {
  return isRecord(value) &&
    isAccountId(value.accountId) &&
    typeof value.role === 'string' &&
    USER_ROLES.includes(value.role as (typeof USER_ROLES)[number]);
}

function requestKey(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_KEY_PATTERN.test(value);
}

function validSet(value: unknown): value is MatchResultSetRecord {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['team1Games', 'team2Games']) ||
    !Number.isInteger(value.team1Games) ||
    !Number.isInteger(value.team2Games) ||
    value.team1Games === value.team2Games
  ) {
    return false;
  }
  const winner = Math.max(value.team1Games as number, value.team2Games as number);
  const loser = Math.min(value.team1Games as number, value.team2Games as number);
  return (winner === 6 && loser >= 0 && loser <= 4) ||
    (winner === 7 && loser >= 5 && loser <= 6);
}

function validSets(value: unknown): value is readonly MatchResultSetRecord[] {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3) || !value.every(validSet)) {
    return false;
  }
  const team1Wins = value.filter((set) => set.team1Games > set.team2Games).length;
  const team2Wins = value.length - team1Wins;
  return value.length === 2
    ? team1Wins === 2 || team2Wins === 2
    : (team1Wins === 2 && team2Wins === 1) ||
        (team2Wins === 2 && team1Wins === 1);
}

function bindingUuid(domain: string, parts: readonly string[]): string {
  return uuidV5FromParts(UUID_URL_NAMESPACE, [domain, ...parts]);
}

function digest(domain: string, parts: readonly string[]): MatchResultRequestDigest {
  const value = createHash('sha256')
    .update(encodeLengthPrefixedUtf8([domain, ...parts]))
    .digest('hex');
  if (!isMatchResultRequestDigest(value)) {
    throw new TypeError('Match result request binding is invalid');
  }
  return value;
}

function rejected(reason: MatchResultApiRejection) {
  return Object.freeze({ outcome: 'rejected' as const, reason });
}

function mapRepositoryRejection(
  reason: MatchResultRejection,
): MatchResultApiRejection {
  return reason === 'command_reuse_conflict' ? 'request_conflict' : reason;
}

function mapPersistence(error: unknown): MatchResultApiRejection {
  if (!(error instanceof MatchResultPersistenceError)) return 'internal_failure';
  switch (error.reason) {
    case 'invalid_input': return 'invalid_request';
    case 'database_unavailable':
    case 'transaction_conflict': return 'temporary_unavailable';
    case 'command_conflict': return 'request_conflict';
    case 'invalid_persisted_state':
    case 'result_conflict':
    case 'referential_integrity':
    case 'permission_denied':
    case 'storage_failure': return 'internal_failure';
  }
}

function response(
  record: import('./match-result.types').MatchResultRecord,
): MatchResultResponse {
  return Object.freeze({
    resultId: record.resultId,
    matchId: record.matchId,
    lineupVersion: record.lineupVersion,
    teams: Object.freeze([
      Object.freeze([record.team1LeftAccountId, record.team1RightAccountId]),
      Object.freeze([record.team2LeftAccountId, record.team2RightAccountId]),
    ]) as MatchResultResponse['teams'],
    sets: record.sets,
    winningTeam: record.winningTeam,
    status: record.status,
    submittedByAccountId: record.submittedByAccountId,
    submittedAt: record.submittedAt,
    ...(record.confirmedByAccountId === undefined
      ? {}
      : { confirmedByAccountId: record.confirmedByAccountId }),
    ...(record.confirmedAt === undefined ? {} : { confirmedAt: record.confirmedAt }),
    ...(record.disputedByAccountId === undefined
      ? {}
      : { disputedByAccountId: record.disputedByAccountId }),
    ...(record.disputedAt === undefined ? {} : { disputedAt: record.disputedAt }),
    version: record.version,
  });
}

export class MatchResultService {
  constructor(readonly dependencies: MatchResultServiceDependencies) {}

  async read(input: ReadMatchResultApiInput): Promise<ReadMatchResultApiResult> {
    if (
      !validActor(input) ||
      !exactKeys(input, ['accountId', 'role', 'matchId']) ||
      input.role !== 'player' ||
      !isMatchId(input.matchId)
    ) {
      return rejected(validActor(input) && input.role !== 'player' ? 'forbidden' : 'invalid_request');
    }
    try {
      const now = this.dependencies.clock.nowEpochSeconds();
      if (!isUnixEpochSeconds(now)) return rejected('internal_failure');
      const result = await this.dependencies.transactions.run((transaction) =>
        this.dependencies.results.read(transaction, {
          matchId: input.matchId,
          actorAccountId: input.accountId,
          now,
        }),
      );
      if (result.outcome === 'rejected') return rejected(result.reason);
      return Object.freeze({ outcome: 'found', result: response(result.result) });
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }

  submit(input: SubmitMatchResultApiInput): Promise<MutateMatchResultApiResult> {
    return this.mutate('submit', input);
  }

  confirm(input: ResolveMatchResultApiInput): Promise<MutateMatchResultApiResult> {
    return this.mutate('confirm', input);
  }

  dispute(input: ResolveMatchResultApiInput): Promise<MutateMatchResultApiResult> {
    return this.mutate('dispute', input);
  }

  private async mutate(
    operation: 'submit' | 'confirm' | 'dispute',
    input: SubmitMatchResultApiInput | ResolveMatchResultApiInput,
  ): Promise<MutateMatchResultApiResult> {
    const expectedRequestKeys = operation === 'submit'
      ? ['requestKey', 'sets']
      : ['requestKey'];
    if (
      !validActor(input) ||
      !exactKeys(input, ['accountId', 'role', 'matchId', 'request']) ||
      input.role !== 'player' ||
      !isMatchId(input.matchId) ||
      !isRecord(input.request) ||
      !exactKeys(input.request, expectedRequestKeys) ||
      !requestKey(input.request.requestKey) ||
      (operation === 'submit' && !validSets(input.request.sets))
    ) {
      return rejected(validActor(input) && input.role !== 'player' ? 'forbidden' : 'invalid_request');
    }
    try {
      const now = this.dependencies.clock.nowEpochSeconds();
      if (!isUnixEpochSeconds(now)) return rejected('internal_failure');
      const request = input.request;
      const submitSets = operation === 'submit'
        ? request.sets as readonly MatchResultSetRecord[]
        : undefined;
      const commandParts = [input.accountId, input.matchId, request.requestKey];
      const requestParts = operation === 'submit'
        ? [
            ...commandParts,
            ...(submitSets ?? []).flatMap((set) => [String(set.team1Games), String(set.team2Games)]),
          ]
        : commandParts;
      const domain = DOMAINS[operation];
      const result = await this.dependencies.transactions.run((transaction) => {
        const common = {
          commandId: bindingUuid(domain.command, commandParts) as MatchResultCommandId,
          matchId: input.matchId,
          actorAccountId: input.accountId,
          requestDigest: digest(domain.request, requestParts),
          now,
        };
        if (operation === 'submit') {
          return this.dependencies.results.submit(transaction, {
            ...common,
            resultId: bindingUuid(DOMAINS.submit.result, [input.matchId]) as MatchResultId,
            sets: submitSets ?? [],
          });
        }
        return operation === 'confirm'
          ? this.dependencies.results.confirm(transaction, common)
          : this.dependencies.results.dispute(transaction, common);
      });
      if (result.outcome === 'rejected') {
        return rejected(mapRepositoryRejection(result.reason));
      }
      return Object.freeze({ outcome: result.outcome, result: result.result });
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }
}

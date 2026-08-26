import { AccountId } from '../accounts/account.types';
import { PostgresTransaction } from './postgres-transaction';

export interface SearchPublicPlayerProfilesInput {
  readonly query: string;
  readonly limit: number;
}

export interface PublicPlayerProfileRecord {
  readonly playerId: AccountId;
  readonly firstName: string;
  readonly lastName?: string;
  readonly username?: string;
  readonly photoUrl?: string;
  readonly rating: number;
  readonly isVerified: boolean;
}

export interface SearchPublicPlayerProfilesResult {
  readonly outcome: 'found';
  readonly players: readonly PublicPlayerProfileRecord[];
}

export interface ReadPublicPlayerProfilesInput {
  readonly playerIds: readonly AccountId[];
}

export interface ReadPublicPlayerProfilesResult {
  readonly outcome: 'found';
  readonly players: readonly PublicPlayerProfileRecord[];
}

export type PublicPlayerVisibilityPolicy = Readonly<{
  enabled: boolean;
  requiredConsents: readonly Readonly<{
    kind: 'terms' | 'cancellation' | 'personal_data_processing';
    documentVersion: string;
  }>[];
}>;

export type PublicPlayerVisibilityParameters = readonly [
  boolean,
  readonly string[],
  readonly string[],
];

export function publicPlayerVisibilityParameters(
  visibility: PublicPlayerVisibilityPolicy,
): PublicPlayerVisibilityParameters {
  const requiredConsents = visibility.requiredConsents;
  if (
    typeof visibility.enabled !== 'boolean' ||
    !Array.isArray(requiredConsents) ||
    requiredConsents.length !== 3 ||
    new Set(requiredConsents.map(({ kind }) => kind)).size !== 3 ||
    requiredConsents.some(
      ({ kind, documentVersion }) =>
        !['terms', 'cancellation', 'personal_data_processing'].includes(kind) ||
        typeof documentVersion !== 'string' ||
        !/^[a-z0-9][a-z0-9_.-]{0,63}$/u.test(documentVersion),
    )
  ) {
    return Object.freeze([
      false,
      Object.freeze([]),
      Object.freeze([]),
    ]);
  }
  return Object.freeze([
    visibility.enabled,
    Object.freeze(requiredConsents.map(({ kind }) => kind)),
    Object.freeze(requiredConsents.map(({ documentVersion }) => documentVersion)),
  ]);
}

export type PublicPlayerProfileSearchPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PublicPlayerProfileSearchPersistenceError extends Error {
  readonly name = 'PublicPlayerProfileSearchPersistenceError';

  constructor(
    readonly reason: PublicPlayerProfileSearchPersistenceFailure,
  ) {
    super('Public player profile search persistence failed');
  }
}

export interface PublicPlayerProfileSearchRepository {
  search(
    transaction: PostgresTransaction,
    input: SearchPublicPlayerProfilesInput,
  ): Promise<SearchPublicPlayerProfilesResult>;

  findByPlayerIds(
    transaction: PostgresTransaction,
    input: ReadPublicPlayerProfilesInput,
  ): Promise<ReadPublicPlayerProfilesResult>;
}

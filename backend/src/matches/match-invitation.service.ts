import { createHash } from 'node:crypto';
import {
  AccountId,
  USER_ROLES,
  isAccountId,
} from '../accounts/account.types';
import {
  encodeLengthPrefixedUtf8,
  uuidV5FromParts,
} from '../auth/crypto-encoding';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  MatchInvitationPersistenceError,
  MatchInvitationRepository,
} from '../database/match-invitation.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  PublicPlayerProfileSearchPersistenceError,
  PublicPlayerProfileSearchRepository,
} from '../database/public-player-profile-search.repository';
import {
  MatchCommandId,
  MatchId,
  MatchInvitationId,
  MatchParticipantId,
  MatchRequestDigest,
  isMatchId,
  isMatchInvitationId,
  isMatchRequestDigest,
} from './match.types';
import {
  MatchInvitationCommandId,
  MatchInvitationRecord,
  MatchInvitationRequestDigest,
  isMatchInvitationRequestDigest,
} from './match-invitation.types';
import {
  CreateMatchInvitationApiInput,
  ListIncomingMatchInvitationsApiInput,
  ListOutgoingMatchInvitationsApiInput,
  MatchInvitationApiActor,
  MatchInvitationApiListResult,
  MatchInvitationApiMutationResult,
  MatchInvitationApiRejection,
  MatchInvitationResponse,
  MutateMatchInvitationApiInput,
} from './match-invitation-api.types';
import {
  readCreateMatchInvitationRequest,
  readMatchInvitationActionRequest,
} from './match-invitation.http';
import { MatchPublicPlayerResponse } from './match-api.types';

const UUID_URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const DOMAINS = Object.freeze({
  create: Object.freeze({
    invitation: 'prosto-padel.match-invitations.create.invitation.v1',
    command: 'prosto-padel.match-invitations.create.command.v1',
    request: 'prosto-padel.match-invitations.create.request.v1',
  }),
  accept: Object.freeze({
    command: 'prosto-padel.match-invitations.accept.command.v1',
    request: 'prosto-padel.match-invitations.accept.request.v1',
    matchCommand:
      'prosto-padel.match-invitations.accept.match-command.v1',
    matchRequest:
      'prosto-padel.match-invitations.accept.match-request.v1',
    participant:
      'prosto-padel.match-invitations.accept.participant.v1',
  }),
  decline: Object.freeze({
    command: 'prosto-padel.match-invitations.decline.command.v1',
    request: 'prosto-padel.match-invitations.decline.request.v1',
  }),
  cancel: Object.freeze({
    command: 'prosto-padel.match-invitations.cancel.command.v1',
    request: 'prosto-padel.match-invitations.cancel.request.v1',
  }),
} as const);

export interface MatchInvitationTransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface MatchInvitationServiceDependencies {
  readonly transactions: MatchInvitationTransactionExecutor;
  readonly invitations: MatchInvitationRepository;
  readonly publicProfiles: Pick<
    PublicPlayerProfileSearchRepository,
    'findByPlayerIds'
  >;
  readonly clock: {
    nowEpochSeconds(): import('../auth/auth.types').UnixEpochSeconds;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validActor(value: unknown): value is MatchInvitationApiActor {
  return (
    isRecord(value) &&
    isAccountId(value.accountId) &&
    typeof value.role === 'string' &&
    USER_ROLES.includes(value.role as (typeof USER_ROLES)[number])
  );
}

function exactKeys(value: object, keys: readonly string[]) {
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  );
}

function bindingUuid(domain: string, parts: readonly string[]) {
  return uuidV5FromParts(UUID_URL_NAMESPACE, [domain, ...parts]);
}

function invitationDigest(
  domain: string,
  parts: readonly string[],
): MatchInvitationRequestDigest {
  const digest = createHash('sha256')
    .update(encodeLengthPrefixedUtf8([domain, ...parts]))
    .digest('hex');
  if (!isMatchInvitationRequestDigest(digest)) {
    throw new TypeError('Invitation request binding is invalid');
  }
  return digest;
}

function matchDigest(
  domain: string,
  parts: readonly string[],
): MatchRequestDigest {
  const digest = createHash('sha256')
    .update(encodeLengthPrefixedUtf8([domain, ...parts]))
    .digest('hex');
  if (!isMatchRequestDigest(digest)) {
    throw new TypeError('Match request binding is invalid');
  }
  return digest;
}

function rejected(reason: MatchInvitationApiRejection) {
  return Object.freeze({ outcome: 'rejected' as const, reason });
}

function mapRejection(reason: string): MatchInvitationApiRejection {
  switch (reason) {
    case 'command_reuse_conflict':
      return 'request_conflict';
    case 'invitation_not_found':
    case 'invitation_closed':
    case 'forbidden':
    case 'match_not_found':
    case 'match_closed':
    case 'match_started':
    case 'match_full':
    case 'slot_unavailable':
    case 'already_participant':
    case 'already_invited':
    case 'player_not_found':
    case 'rating_verification_required':
    case 'rating_out_of_range':
    case 'match_conflict':
      return reason;
    default:
      return 'internal_failure';
  }
}

function mapPersistence(error: unknown): MatchInvitationApiRejection {
  if (error instanceof PublicPlayerProfileSearchPersistenceError) {
    return error.reason === 'database_unavailable' ||
      error.reason === 'transaction_conflict'
      ? 'temporary_unavailable'
      : 'internal_failure';
  }
  if (!(error instanceof MatchInvitationPersistenceError)) {
    return 'internal_failure';
  }
  switch (error.reason) {
    case 'database_unavailable':
    case 'transaction_conflict':
      return 'temporary_unavailable';
    case 'command_conflict':
      return 'request_conflict';
    case 'invitation_conflict':
      return 'match_conflict';
    case 'invalid_input':
      return 'invalid_request';
    case 'invalid_persisted_state':
    case 'referential_integrity':
    case 'permission_denied':
    case 'storage_failure':
      return 'internal_failure';
  }
}

function safePlayer(value: unknown): MatchPublicPlayerResponse | undefined {
  if (
    !isRecord(value) ||
    !isAccountId(value.playerId) ||
    typeof value.firstName !== 'string' ||
    value.firstName.length < 1 ||
    typeof value.rating !== 'number' ||
    !Number.isFinite(value.rating) ||
    typeof value.isVerified !== 'boolean'
  ) {
    return undefined;
  }
  return Object.freeze({
    playerId: value.playerId,
    firstName: value.firstName,
    ...(typeof value.lastName === 'string'
      ? { lastName: value.lastName }
      : {}),
    ...(typeof value.username === 'string'
      ? { username: value.username }
      : {}),
    rating: value.rating,
    isVerified: value.isVerified,
  });
}

async function enrich(
  profiles: MatchInvitationServiceDependencies['publicProfiles'],
  transaction: PostgresTransaction,
  invitations: readonly MatchInvitationRecord[],
): Promise<readonly MatchInvitationResponse[]> {
  if (invitations.length === 0) return Object.freeze([]);
  const ids = Object.freeze([
    ...new Set(
      invitations.flatMap((invitation) => [
        invitation.match.ownerAccountId,
        invitation.invitedAccountId,
      ]),
    ),
  ]);
  const result = await profiles.findByPlayerIds(transaction, {
    playerIds: ids,
  });
  if (
    result.outcome !== 'found' ||
    result.players.length !== ids.length
  ) {
    throw new MatchInvitationPersistenceError(
      'invalid_persisted_state',
    );
  }
  const players = result.players.map(safePlayer);
  if (players.some((player) => player === undefined)) {
    throw new MatchInvitationPersistenceError(
      'invalid_persisted_state',
    );
  }
  const byId = new Map(
    (players as MatchPublicPlayerResponse[]).map((player) => [
      player.playerId,
      player,
    ]),
  );
  if (byId.size !== ids.length) {
    throw new MatchInvitationPersistenceError(
      'invalid_persisted_state',
    );
  }
  return Object.freeze(
    invitations.map((invitation) => {
      const owner = byId.get(invitation.match.ownerAccountId);
      const invitedPlayer = byId.get(invitation.invitedAccountId);
      if (owner === undefined || invitedPlayer === undefined) {
        throw new MatchInvitationPersistenceError(
          'invalid_persisted_state',
        );
      }
      return Object.freeze({
        ...invitation,
        match: Object.freeze({ ...invitation.match, owner }),
        invitedPlayer,
      });
    }),
  );
}

export class MatchInvitationService {
  constructor(readonly dependencies: MatchInvitationServiceDependencies) {}

  async create(
    input: CreateMatchInvitationApiInput,
  ): Promise<MatchInvitationApiMutationResult> {
    const request = readCreateMatchInvitationRequest(input.request);
    if (
      !validActor(input) ||
      !exactKeys(input, ['accountId', 'role', 'matchId', 'request']) ||
      input.role !== 'player' ||
      !isMatchId(input.matchId) ||
      request === undefined
    ) {
      return rejected(
        validActor(input) && input.role !== 'player'
          ? 'forbidden'
          : 'invalid_request',
      );
    }
    try {
      const now = this.dependencies.clock.nowEpochSeconds();
      if (!isUnixEpochSeconds(now)) return rejected('internal_failure');
      const idParts = [input.accountId, request.requestKey];
      const digestParts = [
        input.accountId,
        input.matchId,
        request.playerId,
        String(request.slotNumber),
        request.requestKey,
      ];
      const result = await this.dependencies.transactions.run(
        async (transaction) => {
          const mutation = await this.dependencies.invitations.create(
            transaction,
            {
              invitationId: bindingUuid(
                DOMAINS.create.invitation,
                idParts,
              ) as MatchInvitationId,
              commandId: bindingUuid(
                DOMAINS.create.command,
                idParts,
              ) as MatchInvitationCommandId,
              matchId: input.matchId,
              actorAccountId: input.accountId,
              invitedAccountId: request.playerId,
              slotNumber: request.slotNumber,
              requestDigest: invitationDigest(
                DOMAINS.create.request,
                digestParts,
              ),
              now,
            },
          );
          if (mutation.outcome === 'rejected') return mutation;
          const [invitation] = await enrich(
            this.dependencies.publicProfiles,
            transaction,
            [mutation.invitation],
          );
          return Object.freeze({ ...mutation, invitation });
        },
      );
      if (result.outcome === 'rejected') {
        return rejected(mapRejection(result.reason));
      }
      return Object.freeze({
        outcome: 'invitation_created',
        invitation: result.invitation,
      });
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }

  async listIncoming(
    input: ListIncomingMatchInvitationsApiInput,
  ): Promise<MatchInvitationApiListResult> {
    if (
      !validActor(input) ||
      !exactKeys(input, ['accountId', 'role', 'request']) ||
      !isRecord(input.request) ||
      !exactKeys(input.request, ['limit'])
    ) {
      return rejected('invalid_request');
    }
    try {
      const now = this.dependencies.clock.nowEpochSeconds();
      if (!isUnixEpochSeconds(now)) return rejected('internal_failure');
      const invitations = await this.dependencies.transactions.run(
        async (transaction) => {
          const result =
            await this.dependencies.invitations.listIncoming(
              transaction,
              {
                actorAccountId: input.accountId,
                now,
                limit: input.request.limit,
              },
            );
          if (result.outcome === 'rejected') return result;
          return Object.freeze({
            outcome: 'found' as const,
            invitations: await enrich(
              this.dependencies.publicProfiles,
              transaction,
              result.invitations,
            ),
          });
        },
      );
      return invitations.outcome === 'rejected'
        ? rejected(mapRejection(invitations.reason))
        : invitations;
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }

  async listOutgoing(
    input: ListOutgoingMatchInvitationsApiInput,
  ): Promise<MatchInvitationApiListResult> {
    if (
      !validActor(input) ||
      !exactKeys(input, ['accountId', 'role', 'matchId', 'request']) ||
      !isMatchId(input.matchId) ||
      !isRecord(input.request) ||
      !exactKeys(input.request, ['limit'])
    ) {
      return rejected('invalid_request');
    }
    try {
      const invitations = await this.dependencies.transactions.run(
        async (transaction) => {
          const result =
            await this.dependencies.invitations.listOutgoing(
              transaction,
              {
                matchId: input.matchId,
                actorAccountId: input.accountId,
                limit: input.request.limit,
              },
            );
          if (result.outcome === 'rejected') return result;
          return Object.freeze({
            outcome: 'found' as const,
            invitations: await enrich(
              this.dependencies.publicProfiles,
              transaction,
              result.invitations,
            ),
          });
        },
      );
      return invitations.outcome === 'rejected'
        ? rejected(mapRejection(invitations.reason))
        : invitations;
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }

  accept(
    input: MutateMatchInvitationApiInput,
  ): Promise<MatchInvitationApiMutationResult> {
    return this.mutate('accept', input);
  }

  decline(
    input: MutateMatchInvitationApiInput,
  ): Promise<MatchInvitationApiMutationResult> {
    return this.mutate('decline', input);
  }

  cancel(
    input: MutateMatchInvitationApiInput,
  ): Promise<MatchInvitationApiMutationResult> {
    return this.mutate('cancel', input);
  }

  private async mutate(
    operation: 'accept' | 'decline' | 'cancel',
    input: MutateMatchInvitationApiInput,
  ): Promise<MatchInvitationApiMutationResult> {
    const request = readMatchInvitationActionRequest(input.request);
    if (
      !validActor(input) ||
      !exactKeys(input, [
        'accountId',
        'role',
        'invitationId',
        'request',
      ]) ||
      input.role !== 'player' ||
      !isMatchInvitationId(input.invitationId) ||
      request === undefined
    ) {
      return rejected(
        validActor(input) && input.role !== 'player'
          ? 'forbidden'
          : 'invalid_request',
      );
    }
    try {
      const now = this.dependencies.clock.nowEpochSeconds();
      if (!isUnixEpochSeconds(now)) return rejected('internal_failure');
      const parts = [
        input.accountId,
        input.invitationId,
        request.requestKey,
      ];
      const result = await this.dependencies.transactions.run(
        async (transaction) => {
          const common = {
            invitationId: input.invitationId,
            actorAccountId: input.accountId,
            commandId: bindingUuid(
              DOMAINS[operation].command,
              parts,
            ) as MatchInvitationCommandId,
            requestDigest: invitationDigest(
              DOMAINS[operation].request,
              parts,
            ),
            now,
          };
          const mutation =
            operation === 'accept'
              ? await this.dependencies.invitations.accept(
                  transaction,
                  {
                    ...common,
                    matchCommandId: bindingUuid(
                      DOMAINS.accept.matchCommand,
                      parts,
                    ) as MatchCommandId,
                    matchRequestDigest: matchDigest(
                      DOMAINS.accept.matchRequest,
                      parts,
                    ),
                    participantId: bindingUuid(
                      DOMAINS.accept.participant,
                      parts,
                    ) as MatchParticipantId,
                  },
                )
              : operation === 'decline'
                ? await this.dependencies.invitations.decline(
                    transaction,
                    common,
                  )
                : await this.dependencies.invitations.cancel(
                    transaction,
                    common,
                  );
          if (mutation.outcome === 'rejected') return mutation;
          const [invitation] = await enrich(
            this.dependencies.publicProfiles,
            transaction,
            [mutation.invitation],
          );
          return Object.freeze({ ...mutation, invitation });
        },
      );
      if (result.outcome === 'rejected') {
        return rejected(mapRejection(result.reason));
      }
      if (result.outcome === 'invitation_accepted') {
        return Object.freeze({
          outcome: 'invitation_accepted',
          result: Object.freeze({
            invitation: result.invitation,
            participant: Object.freeze({
              participantId: result.participant.participantId,
              accountId: result.participant.accountId,
              slotNumber: result.participant.slotNumber,
              status: result.participant.status,
            }),
            matchVersion: result.matchVersion,
          }),
        });
      }
      return Object.freeze({
        outcome: result.outcome,
        invitation: result.invitation,
      });
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }
}

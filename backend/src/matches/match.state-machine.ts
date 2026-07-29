import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  AppliedMatchCommand,
  CreateMatchCommand,
  JoinMatchCommand,
  LeaveMatchCommand,
  MatchCommand,
  MatchCommandResultType,
  MatchParticipantState,
  MatchSlotNumber,
  MatchState,
  isMatchCommandId,
  isMatchId,
  isMatchParticipantId,
  isMatchRequestDigest,
} from './match.types';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const ACTIVE_MATCH_STATUSES = new Set([
  'open',
  'searching',
  'confirmed',
  'upcoming',
]);

export type MatchTransitionRejection =
  | 'invalid_match_state'
  | 'invalid_match_command'
  | 'command_reuse_conflict'
  | 'match_already_exists'
  | 'match_not_found'
  | 'match_closed'
  | 'match_not_joinable'
  | 'match_started'
  | 'rating_verification_required'
  | 'rating_out_of_range'
  | 'owner_cannot_join'
  | 'already_joined'
  | 'match_full'
  | 'participant_not_active';

export type MatchTransitionResult =
  | {
      readonly outcome: 'transitioned';
      readonly transition:
        | 'match_created'
        | 'participant_joined'
        | 'participant_left';
      readonly state: MatchState;
      readonly command: AppliedMatchCommand;
      readonly participant?: MatchParticipantState;
    }
  | {
      readonly outcome: 'idempotent_retry';
      readonly originalCommand: AppliedMatchCommand;
      readonly state: MatchState;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchTransitionRejection;
    };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isBoundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === 'string' &&
    [...value].length >= minimum &&
    [...value].length <= maximum &&
    value.trim() === value &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function isOptionalBoundedText(
  value: unknown,
  maximum: number,
): value is string | undefined {
  return value === undefined || isBoundedText(value, 1, maximum);
}

function isSafeVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isValidFormat(command: CreateMatchCommand): boolean {
  if (command.kind === 'private') {
    return (
      command.visibility === 'private' &&
      command.scenario === 'private' &&
      command.status === 'upcoming' &&
      command.ratingMin === undefined &&
      command.ratingMax === undefined &&
      command.isRatingMatch === false
    );
  }
  return (
    command.kind === 'match' &&
    command.visibility === 'public' &&
    ((command.scenario === 'community' &&
      command.status === 'searching') ||
      (command.scenario === 'social' &&
        command.status === 'confirmed')) &&
    Number.isInteger(command.ratingMin) &&
    Number.isInteger(command.ratingMax) &&
    (command.ratingMin as number) >= 0 &&
    (command.ratingMax as number) <= 6 &&
    (command.ratingMin as number) <= (command.ratingMax as number)
  );
}

function isValidCommandBase(command: MatchCommand): boolean {
  return (
    isPlainRecord(command) &&
    isMatchId(command.matchId) &&
    isMatchCommandId(command.commandId) &&
    isAccountId(command.actorAccountId) &&
    isMatchRequestDigest(command.requestDigest) &&
    isUnixEpochSeconds(command.now)
  );
}

function isValidCreateCommand(command: CreateMatchCommand): boolean {
  return (
    isValidCommandBase(command) &&
    isUnixEpochSeconds(command.startsAt) &&
    command.startsAt >= command.now &&
    [60, 90, 120, 150].includes(command.durationMinutes) &&
    isBoundedText(command.courtId, 1, 64) &&
    isBoundedText(command.courtName, 1, 128) &&
    isBoundedText(command.courtType, 1, 64) &&
    isOptionalBoundedText(command.title, 160) &&
    typeof command.description === 'string' &&
    [...command.description].length <= 2000 &&
    typeof command.isRatingMatch === 'boolean' &&
    typeof command.actorIsVerified === 'boolean' &&
    (command.pricePerPersonSnapshot === undefined ||
      (typeof command.pricePerPersonSnapshot === 'number' &&
        Number.isFinite(command.pricePerPersonSnapshot) &&
        command.pricePerPersonSnapshot > 0 &&
        command.pricePerPersonSnapshot <= 1_000_000 &&
        Number(command.pricePerPersonSnapshot.toFixed(2)) ===
          command.pricePerPersonSnapshot)) &&
    isValidFormat(command)
  );
}

function isValidJoinCommand(command: JoinMatchCommand): boolean {
  const reservedSlots = command.reservedSlotNumbers ?? [];
  return (
    isValidCommandBase(command) &&
    isMatchParticipantId(command.participantId) &&
    Number.isInteger(command.actorRatingLevel) &&
    command.actorRatingLevel >= 0 &&
    command.actorRatingLevel <= 6 &&
    typeof command.actorIsVerified === 'boolean' &&
    (command.requestedSlotNumber === undefined ||
      [2, 3, 4].includes(command.requestedSlotNumber)) &&
    Array.isArray(reservedSlots) &&
    reservedSlots.length <= 3 &&
    reservedSlots.every((slot) => [2, 3, 4].includes(slot)) &&
    new Set(reservedSlots).size === reservedSlots.length &&
    (command.requestedSlotNumber === undefined ||
      !reservedSlots.includes(command.requestedSlotNumber))
  );
}

function isValidLeaveCommand(command: LeaveMatchCommand): boolean {
  return isValidCommandBase(command);
}

export function isValidMatchCommand(command: MatchCommand): boolean {
  switch (command.type) {
    case 'create_match':
      return isValidCreateCommand(command);
    case 'join_match':
      return isValidJoinCommand(command);
    case 'leave_match':
      return isValidLeaveCommand(command);
  }
}

function sameBinding(
  applied: AppliedMatchCommand,
  command: MatchCommand,
): boolean {
  return (
    applied.matchId === command.matchId &&
    applied.actorAccountId === command.actorAccountId &&
    applied.requestDigest === command.requestDigest &&
    applied.commandType === command.type
  );
}

function nextSlot(
  state: MatchState,
  command: JoinMatchCommand,
): MatchSlotNumber | undefined {
  const active = new Set(
    state.participants
      .filter((participant) => participant.status === 'active')
      .map((participant) => participant.slotNumber),
  );
  const reserved = new Set(command.reservedSlotNumbers ?? []);
  if (command.requestedSlotNumber !== undefined) {
    return active.has(command.requestedSlotNumber) ||
      reserved.has(command.requestedSlotNumber)
      ? undefined
      : command.requestedSlotNumber;
  }
  return ([2, 3, 4] as const).find(
    (slot) => !active.has(slot) && !reserved.has(slot),
  );
}

function appliedCommand(
  command: MatchCommand,
  sequence: number,
  resultType: MatchCommandResultType,
  participantId?: MatchParticipantState['participantId'],
): AppliedMatchCommand {
  return Object.freeze({
    commandId: command.commandId,
    matchId: command.matchId,
    actorAccountId: command.actorAccountId,
    commandSequence: sequence,
    requestDigest: command.requestDigest,
    commandType: command.type,
    appliedAt: command.now,
    ...(participantId === undefined ? {} : { participantId }),
    resultType,
    matchVersion: sequence,
  });
}

function appendCommand(
  state: MatchState,
  command: AppliedMatchCommand,
  participants: readonly MatchParticipantState[],
  status: MatchState['status'] = state.status,
): MatchState {
  return Object.freeze({
    ...state,
    updatedAt: command.appliedAt,
    status,
    version: command.matchVersion,
    participants: Object.freeze([...participants]),
    appliedCommands: Object.freeze([...state.appliedCommands, command]),
  });
}

function statusAfterSlotChange(
  state: MatchState,
  activeParticipantCount: number,
): MatchState['status'] {
  if (state.kind === 'private' || state.status === 'searching') {
    return state.status;
  }
  if (state.status === 'confirmed') {
    return activeParticipantCount >= 3 ? 'confirmed' : 'open';
  }
  return activeParticipantCount >= 3 ? 'upcoming' : 'open';
}

function createMatch(
  state: MatchState | null,
  command: CreateMatchCommand,
): MatchTransitionResult {
  if (!isValidCreateCommand(command)) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'invalid_match_command',
    });
  }
  if (state !== null) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'match_already_exists',
    });
  }
  if (command.isRatingMatch && !command.actorIsVerified) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'rating_verification_required',
    });
  }
  const persistedCommand = appliedCommand(
    command,
    1,
    'match_created',
  );
  const nextState: MatchState = Object.freeze({
    matchId: command.matchId,
    ownerAccountId: command.actorAccountId,
    createdAt: command.now,
    updatedAt: command.now,
    startsAt: command.startsAt,
    durationMinutes: command.durationMinutes,
    courtId: command.courtId,
    courtName: command.courtName,
    courtType: command.courtType,
    kind: command.kind,
    visibility: command.visibility,
    scenario: command.scenario,
    status: command.status,
    ...(command.title === undefined ? {} : { title: command.title }),
    description: command.description,
    ...(command.ratingMin === undefined
      ? {}
      : { ratingMin: command.ratingMin }),
    ...(command.ratingMax === undefined
      ? {}
      : { ratingMax: command.ratingMax }),
    isRatingMatch: command.isRatingMatch,
    ...(command.pricePerPersonSnapshot === undefined
      ? {}
      : { pricePerPersonSnapshot: command.pricePerPersonSnapshot }),
    version: 1,
    participants: Object.freeze([]),
    appliedCommands: Object.freeze([persistedCommand]),
  });
  return Object.freeze({
    outcome: 'transitioned',
    transition: 'match_created',
    state: nextState,
    command: persistedCommand,
  });
}

function joinMatch(
  state: MatchState,
  command: JoinMatchCommand,
): MatchTransitionResult {
  if (!isValidJoinCommand(command)) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'invalid_match_command',
    });
  }
  if (command.now < state.updatedAt) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'invalid_match_command',
    });
  }
  if (
    state.visibility !== 'public' ||
    (state.status !== 'open' &&
      state.status !== 'searching' &&
      state.status !== 'confirmed' &&
      state.status !== 'upcoming')
  ) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'match_not_joinable',
    });
  }
  if (command.now >= state.startsAt) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'match_started',
    });
  }
  if (state.isRatingMatch && !command.actorIsVerified) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'rating_verification_required',
    });
  }
  if (
    state.ratingMin === undefined ||
    state.ratingMax === undefined ||
    command.actorRatingLevel < state.ratingMin ||
    command.actorRatingLevel > state.ratingMax
  ) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'rating_out_of_range',
    });
  }
  if (state.ownerAccountId === command.actorAccountId) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'owner_cannot_join',
    });
  }
  if (
    state.participants.some(
      (participant) =>
        participant.accountId === command.actorAccountId &&
        participant.status === 'active',
    )
  ) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'already_joined',
    });
  }
  const slotNumber = nextSlot(state, command);
  if (slotNumber === undefined) {
    return Object.freeze({ outcome: 'rejected', reason: 'match_full' });
  }
  const sequence = state.version + 1;
  const participant: MatchParticipantState = Object.freeze({
    participantId: command.participantId,
    accountId: command.actorAccountId,
    slotNumber,
    status: 'active',
    joinedAt: command.now,
    updatedAt: command.now,
    version: 1,
  });
  const persistedCommand = appliedCommand(
    command,
    sequence,
    'participant_joined',
    participant.participantId,
  );
  const nextState = appendCommand(
    state,
    persistedCommand,
    [...state.participants, participant],
    statusAfterSlotChange(
      state,
      state.participants.filter(
        (candidate) => candidate.status === 'active',
      ).length + 1,
    ),
  );
  return Object.freeze({
    outcome: 'transitioned',
    transition: 'participant_joined',
    state: nextState,
    command: persistedCommand,
    participant,
  });
}

function leaveMatch(
  state: MatchState,
  command: LeaveMatchCommand,
): MatchTransitionResult {
  if (!isValidLeaveCommand(command)) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'invalid_match_command',
    });
  }
  if (command.now < state.updatedAt) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'invalid_match_command',
    });
  }
  if (!ACTIVE_MATCH_STATUSES.has(state.status)) {
    return Object.freeze({ outcome: 'rejected', reason: 'match_closed' });
  }
  if (command.now >= state.startsAt) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'match_started',
    });
  }
  const current = state.participants.find(
    (participant) =>
      participant.accountId === command.actorAccountId &&
      participant.status === 'active',
  );
  if (current === undefined) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'participant_not_active',
    });
  }
  const sequence = state.version + 1;
  const participant: MatchParticipantState = Object.freeze({
    ...current,
    status: 'left',
    updatedAt: command.now,
    leftAt: command.now,
    version: current.version + 1,
  });
  const persistedCommand = appliedCommand(
    command,
    sequence,
    'participant_left',
    current.participantId,
  );
  const nextState = appendCommand(
    state,
    persistedCommand,
    state.participants.map((candidate) =>
      candidate.participantId === current.participantId
        ? participant
        : candidate,
    ),
    statusAfterSlotChange(
      state,
      state.participants.filter(
        (candidate) =>
          candidate.status === 'active' &&
          candidate.participantId !== current.participantId,
      ).length,
    ),
  );
  return Object.freeze({
    outcome: 'transitioned',
    transition: 'participant_left',
    state: nextState,
    command: persistedCommand,
    participant,
  });
}

export function transitionMatch(
  state: MatchState | null,
  command: MatchCommand,
): MatchTransitionResult {
  if (!isPlainRecord(command) || typeof command.type !== 'string') {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'invalid_match_command',
    });
  }
  if (state === null) {
    return command.type === 'create_match'
      ? createMatch(state, command)
      : Object.freeze({
          outcome: 'rejected',
          reason: 'match_not_found',
        });
  }
  if (
    !isMatchId(state.matchId) ||
    !isAccountId(state.ownerAccountId) ||
    !isSafeVersion(state.version) ||
    state.matchId !== command.matchId
  ) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'invalid_match_state',
    });
  }
  const existing = state.appliedCommands.find(
    (candidate) => candidate.commandId === command.commandId,
  );
  if (existing !== undefined) {
    return sameBinding(existing, command)
      ? Object.freeze({
          outcome: 'idempotent_retry',
          originalCommand: existing,
          state,
        })
      : Object.freeze({
          outcome: 'rejected',
          reason: 'command_reuse_conflict',
        });
  }
  switch (command.type) {
    case 'create_match':
      return createMatch(state, command);
    case 'join_match':
      return joinMatch(state, command);
    case 'leave_match':
      return leaveMatch(state, command);
  }
}

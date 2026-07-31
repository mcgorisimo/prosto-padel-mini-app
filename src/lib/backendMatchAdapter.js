import { getLevelForRating } from './ratingEngine';

const LEVELS = Object.freeze(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const MOSCOW_OFFSET = '+03:00';
const BACKEND_FEED_STATUSES = Object.freeze([
  'open',
  'searching',
  'confirmed',
  'upcoming',
]);

export const BACKEND_PRIVATE_MATCH_CREATION_ENABLED = false;

export function resolveBackendMatchMode({
  backendRequired,
  hasBackendActions,
  lifecycleStatus,
  profileStatus,
  accountId,
}) {
  if (!backendRequired) return 'legacy';
  if (!hasBackendActions) {
    return (
      profileStatus === 'error' ||
      lifecycleStatus === 'internal_error' ||
      lifecycleStatus === 'session_expired'
    )
      ? 'error'
      : 'loading';
  }
  if (profileStatus === 'ready' && typeof accountId === 'string') {
    return 'ready';
  }
  return profileStatus === 'error' ? 'error' : 'loading';
}

export function shouldApplyBackendMatchFeedResponse(
  activeRequestId,
  completedRequestId,
) {
  return activeRequestId === completedRequestId;
}

export function applyBackendParticipantResult(
  match,
  participant,
  currentPlayer,
) {
  if (
    !isBackendOwnedMatch(match) ||
    participant?.matchId !== match.id ||
    participant?.playerId !== currentPlayer?.id ||
    ![2, 3, 4].includes(participant.slotNumber) ||
    !['active', 'left'].includes(participant.status) ||
    !Number.isSafeInteger(participant.matchVersion) ||
    participant.matchVersion < match.version
  ) {
    return null;
  }

  const slots = Array(4).fill(null);
  for (const player of match.filledSlots ?? []) {
    const slotIndex = Number(player?.slotIndex);
    if (
      Number.isInteger(slotIndex) &&
      slotIndex >= 0 &&
      slotIndex < slots.length &&
      player?.id !== participant.playerId
    ) {
      slots[slotIndex] = player;
    }
  }

  if (participant.status === 'active') {
    slots[participant.slotNumber - 1] = Object.freeze({
      ...currentPlayer,
      isOrganizer: false,
      slotIndex: participant.slotNumber - 1,
    });
  }

  const occupiedSlots = slots.filter(Boolean).length;
  let status = match.status;
  if (participant.status === 'active' && occupiedSlots === 4) {
    status = 'upcoming';
  } else if (
    participant.status === 'left' &&
    occupiedSlots < 4 &&
    (status === 'upcoming' || status === 'confirmed')
  ) {
    status = 'open';
  }

  return Object.freeze({
    ...match,
    status,
    players: occupiedSlots,
    occupiedSlots,
    filledSlots: Object.freeze(slots),
    participants: Object.freeze(
      slots.filter(Boolean).map(({ id }) => id),
    ),
    version: participant.matchVersion,
  });
}

export function preferConfirmedBackendMatchMutation(
  confirmedMatch,
  refreshedMatch,
) {
  if (!isBackendOwnedMatch(confirmedMatch)) {
    return refreshedMatch ?? confirmedMatch ?? null;
  }
  if (
    isBackendOwnedMatch(refreshedMatch) &&
    refreshedMatch.id === confirmedMatch.id &&
    Number.isSafeInteger(refreshedMatch.version) &&
    Number.isSafeInteger(confirmedMatch.version) &&
    refreshedMatch.version >= confirmedMatch.version
  ) {
    return refreshedMatch;
  }
  return confirmedMatch;
}

export function isBackendOwnedMatch(match) {
  return match?.backendOwned === true;
}

export function selectFutureBackendMatches(
  matches,
  nowEpochSeconds,
) {
  if (
    !Array.isArray(matches) ||
    !Number.isSafeInteger(nowEpochSeconds) ||
    nowEpochSeconds < 0
  ) {
    return [];
  }

  return matches.filter((match) => (
    isBackendOwnedMatch(match) &&
    BACKEND_FEED_STATUSES.includes(match.status) &&
    Number.isSafeInteger(match.startsAt) &&
    match.startsAt > nowEpochSeconds
  ));
}

export function selectBackendAccountMatches(
  matches,
  accountId,
  nowEpochSeconds,
) {
  if (typeof accountId !== 'string' || accountId.length === 0) {
    return [];
  }

  return selectFutureBackendMatches(matches, nowEpochSeconds)
    .filter((match) => (
      match.ownerId === accountId ||
      match.participants?.includes(accountId)
    ));
}

export function mergeAccountUpcomingMatches(
  legacyMatches,
  backendMatches,
  accountId,
  nowEpochSeconds,
) {
  return [
    ...(Array.isArray(legacyMatches) ? legacyMatches : []),
    ...selectBackendAccountMatches(
      backendMatches,
      accountId,
      nowEpochSeconds,
    ),
  ];
}

export function mapBackendPublicPlayerToApp(player) {
  if (!player || typeof player !== 'object') return null;
  return Object.freeze({
    id: player.playerId,
    first_name: player.firstName,
    last_name: player.lastName ?? '',
    username: player.username ?? '',
    rating: player.rating,
    is_verified: player.isVerified,
    side_preference: 'Both',
    backendOwned: true,
  });
}

export function mapBackendMatchMessageToApp(message) {
  if (!message || typeof message !== 'object') return null;
  const createdAt = Number(message.createdAt);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) return null;
  const senderUnavailable = message.sender?.unavailable === true;
  const senderId = senderUnavailable ? null : message.sender?.playerId;
  const senderName = senderUnavailable
    ? 'Игрок недоступен'
    : [
        message.sender?.firstName,
        message.sender?.lastName,
      ].filter(Boolean).join(' ');
  if (
    typeof message.messageId !== 'string' ||
    typeof message.matchId !== 'string' ||
    typeof message.body !== 'string' ||
    (!senderUnavailable &&
      (typeof senderId !== 'string' || senderName.length === 0))
  ) {
    return null;
  }
  return Object.freeze({
    id: message.messageId,
    matchId: message.matchId,
    match_id: message.matchId,
    senderId,
    sender_id: senderId,
    senderName,
    sender_name: senderName,
    text: message.body,
    timestamp: new Date(createdAt * 1_000).toISOString(),
    created_at: new Date(createdAt * 1_000).toISOString(),
    senderUnavailable,
    backendOwned: true,
  });
}

export function mapBackendInvitationToApp(invitation) {
  if (!invitation || typeof invitation !== 'object') return null;
  const dateTime = moscowDateTime(invitation.match?.startsAt);
  const invitedPlayer = mapBackendPublicPlayerToApp(
    invitation.invitedPlayer,
  );
  if (!dateTime || !invitedPlayer) return null;

  return Object.freeze({
    id: invitation.invitationId,
    invitation_id: invitation.invitationId,
    match_id: invitation.matchId,
    invited_by: invitation.invitedByAccountId,
    invited_user_id: invitation.invitedAccountId,
    slot_index: invitation.slotNumber - 1,
    status: invitation.status,
    created_at: invitation.createdAt,
    updated_at: invitation.updatedAt,
    responded_at: invitation.respondedAt ?? null,
    version: invitation.version,
    organizer_first_name: invitation.match.owner.firstName,
    organizer_last_name: invitation.match.owner.lastName ?? '',
    date_iso: dateTime.dateISO,
    start_time: dateTime.time,
    court_name: invitation.match.courtName,
    rating_min: invitation.match.ratingMin,
    rating_max: invitation.match.ratingMax,
    is_rating_match: invitation.match.isRatingMatch,
    price_per_person:
      invitation.match.pricePerPersonSnapshot ?? null,
    player: Object.freeze({
      ...invitedPlayer,
      firstName: invitedPlayer.first_name,
      lastName: invitedPlayer.last_name,
      numericRating: invitedPlayer.rating,
      isVerified: invitedPlayer.is_verified,
    }),
    backendOwned: true,
  });
}

export function resolveMatchSource(
  matchId,
  explicitMatch = null,
  backendMatches = [],
  legacyMatches = [],
) {
  const normalizedMatchId = String(matchId);
  if (
    explicitMatch &&
    String(explicitMatch.id) === normalizedMatchId
  ) {
    return explicitMatch;
  }

  return (
    backendMatches.find(
      (match) => String(match?.id) === normalizedMatchId,
    ) ??
    legacyMatches.find(
      (match) => String(match?.id) === normalizedMatchId,
    ) ??
    null
  );
}

export function shouldApplyBackendMatchDetail(
  selectedMatch,
  requestedMatchId,
  detailedMatch,
) {
  const normalizedMatchId = String(requestedMatchId);
  return (
    isBackendOwnedMatch(selectedMatch) &&
    String(selectedMatch.id) === normalizedMatchId &&
    isBackendOwnedMatch(detailedMatch) &&
    String(detailedMatch.id) === normalizedMatchId &&
    Number.isSafeInteger(selectedMatch.version) &&
    Number.isSafeInteger(detailedMatch.version) &&
    detailedMatch.version >= selectedMatch.version
  );
}

const moscowDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function moscowDateTime(epochSeconds) {
  const date = new Date(epochSeconds * 1_000);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(
    moscowDateTimeFormatter
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  );
  if (
    !parts.year ||
    !parts.month ||
    !parts.day ||
    !parts.hour ||
    !parts.minute
  ) {
    return null;
  }
  return Object.freeze({
    dateISO: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  });
}

function profilePlayer(profile, player, isOrganizer, slotIndex) {
  const publicPlayer =
    player && typeof player === 'object' ? player : null;
  const playerId =
    publicPlayer === null ? player : publicPlayer.playerId;
  const isCurrentPlayer = profile?.accountId === playerId;
  const numericRating =
    typeof publicPlayer?.rating === 'number'
      ? publicPlayer.rating
      : isCurrentPlayer && typeof profile.rating === 'number'
        ? profile.rating
        : 3;
  const level = getLevelForRating(numericRating)?.label ?? 'C';
  return Object.freeze({
    id: playerId,
    firstName:
      publicPlayer?.firstName ??
      (isCurrentPlayer
        ? profile.firstName
        : isOrganizer
          ? 'Организатор'
          : 'Игрок'),
    lastName:
      publicPlayer?.lastName ??
      (isCurrentPlayer ? (profile.lastName ?? '') : ''),
    username:
      publicPlayer?.username ??
      (isCurrentPlayer ? (profile.username ?? '') : ''),
    photoUrl: isCurrentPlayer ? profile.photoUrl : null,
    numericRating,
    rating: numericRating,
    ratingIdx: Math.max(0, LEVELS.indexOf(level)),
    isVerified:
      publicPlayer?.isVerified === true ||
      (publicPlayer === null &&
        isCurrentPlayer &&
        profile.isVerified === true),
    sidePreference: isCurrentPlayer
      ? (profile.sidePreference ?? 'Both')
      : 'Both',
    isOrganizer,
    slotIndex,
  });
}

function feedPlaceholders(record, owner) {
  const slots = [owner];
  for (
    let slotNumber = 2;
    slotNumber <= Math.min(record.occupiedSlots, 4);
    slotNumber += 1
  ) {
    slots.push(profilePlayer(
      null,
      `occupied:${record.matchId}:${slotNumber}`,
      false,
      slotNumber - 1,
    ));
  }
  return slots;
}

export function createBackendMatchDraft(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    !DATE_PATTERN.test(value.dateISO ?? '') ||
    !TIME_PATTERN.test(value.time ?? '')
  ) {
    return null;
  }

  const startsAtMilliseconds = Date.parse(
    `${value.dateISO}T${value.time}:00${MOSCOW_OFFSET}`,
  );
  const durationMinutes = Number(value.duration) * 60;
  const scenario = value.isPrivate === true
    ? 'private'
    : value.scenario;
  const description =
    typeof value.description === 'string' ? value.description : '';

  if (
    !Number.isFinite(startsAtMilliseconds) ||
    ![60, 90, 120, 150].includes(durationMinutes) ||
    !['community', 'social', 'private'].includes(scenario)
  ) {
    return null;
  }

  const draft = {
    startsAt: Math.floor(startsAtMilliseconds / 1_000),
    durationMinutes,
    ...(typeof value.courtId === 'string' && value.courtId.length > 0
      ? { courtId: value.courtId }
      : {}),
    scenario,
    description,
    ...(scenario === 'private'
      ? {}
      : {
          ratingMin: value.ratingMin,
          ratingMax: value.ratingMax,
        }),
    isRatingMatch:
      scenario === 'private' ? false : value.isRatingMatch === true,
  };

  return Object.freeze(draft);
}

export function mapBackendMatchToApp(record, profile = null) {
  if (!record || typeof record !== 'object') return null;
  const dateTime = moscowDateTime(record.startsAt);
  if (!dateTime) return null;

  const owner = profilePlayer(
    profile,
    record.owner ?? record.ownerAccountId,
    true,
    0,
  );
  let filledSlots;
  if (Array.isArray(record.participants)) {
    filledSlots = Array(4).fill(null);
    filledSlots[0] = owner;
    for (const participant of record.participants) {
      filledSlots[participant.slotNumber - 1] = profilePlayer(
        profile,
        participant.firstName === undefined
          ? participant.playerId
          : participant,
        false,
        participant.slotNumber - 1,
      );
    }
  } else {
    filledSlots = feedPlaceholders(record, owner);
  }
  const participants = filledSlots
    .filter(Boolean)
    .map(({ id }) => id);

  return Object.freeze({
    id: record.matchId,
    ownerId: record.ownerAccountId,
    owner_id: record.ownerAccountId,
    ownerName: owner.firstName,
    startsAt: record.startsAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    dateISO: dateTime.dateISO,
    time: dateTime.time,
    duration: record.durationMinutes / 60,
    courtId: record.courtId,
    courtName: record.courtName,
    courtType: record.courtType,
    kind: record.kind ?? 'match',
    type: record.kind ?? 'match',
    visibility: record.visibility ?? 'public',
    scenario: record.scenario,
    status: record.status,
    description: record.description ?? '',
    ratingMin: record.ratingMin,
    ratingMax: record.ratingMax,
    isRatingMatch: record.isRatingMatch,
    is_rating_match: record.isRatingMatch,
    requiresVerifiedRating: record.isRatingMatch,
    isPrivate:
      record.visibility === 'private' || record.scenario === 'private',
    pricePerPerson: record.pricePerPersonSnapshot ?? null,
    players: filledSlots.filter(Boolean).length,
    occupiedSlots:
      record.occupiedSlots ?? filledSlots.filter(Boolean).length,
    filledSlots: Object.freeze(filledSlots),
    participants: Object.freeze(participants),
    version: record.version,
    terminalAt: record.terminalAt,
    backendOwned: true,
  });
}

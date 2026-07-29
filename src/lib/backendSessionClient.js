import { isCanonicalSessionCredential } from './sessionCredential';

const REFRESH_PATH = '/api/v1/auth/session/refresh';
const LOGOUT_PATH = '/api/v1/auth/session/logout';
const AUTHENTICATE_PATH = '/api/v1/auth/session/me';
const PROFILE_PATH = '/api/v1/profile/me';
const MATCHES_PATH = '/api/v1/matches';
const PLAYER_SEARCH_PATH = '/api/v1/players/search';
const MATCH_INVITATIONS_PATH = '/api/v1/match-invitations';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REQUESTS = 3;
const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 2_000;
const MAX_RESPONSE_BODY_BYTES = 32_768;
const MAX_PLAYER_SEARCH_RESPONSE_BODY_BYTES = 65_536;
const MAX_MATCH_FEED_RESPONSE_BODY_BYTES = 1_048_576;
const MAX_MATCH_INVITATION_RESPONSE_BODY_BYTES = 524_288;

const BODY_ABORTED = Symbol('backend-session-body-aborted');
const BODY_INVALID = Symbol('backend-session-body-invalid');
const BODY_NETWORK_FAILURE = Symbol('backend-session-body-network-failure');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INTERNAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const PROFILE_PATCH_KEYS = Object.freeze([
  'firstName',
  'lastName',
  'phone',
  'sidePreference',
]);
const SIDE_PREFERENCES = Object.freeze(['Left', 'Both', 'Right']);
const MATCH_DURATIONS = Object.freeze([60, 90, 120, 150]);
const MATCH_SCENARIOS = Object.freeze(['community', 'social', 'private']);
const MATCH_STATUSES = Object.freeze([
  'open',
  'searching',
  'confirmed',
  'upcoming',
  'completed',
  'cancelled',
]);
const MATCH_FEED_STATUSES = Object.freeze([
  'open',
  'searching',
  'confirmed',
  'upcoming',
]);
const MATCH_CREATE_REQUIRED_KEYS = Object.freeze([
  'startsAt',
  'durationMinutes',
  'scenario',
  'description',
  'isRatingMatch',
]);
const MATCH_CREATE_OPTIONAL_KEYS = Object.freeze([
  'courtId',
  'title',
  'ratingMin',
  'ratingMax',
]);
const MATCH_INVITATION_STATUSES = Object.freeze([
  'pending',
  'accepted',
  'declined',
  'cancelled',
]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const LEGACY_PROFILE_KEYS = Object.freeze([
  'accountId',
  'firstName',
  'languageCode',
  'lastName',
  'phone',
  'photoUrl',
  'role',
  'sidePreference',
  'username',
]);
const RATING_PROFILE_KEYS = Object.freeze([
  'accountId',
  'firstName',
  'isVerified',
  'languageCode',
  'lastName',
  'phone',
  'photoUrl',
  'rating',
  'role',
  'sidePreference',
  'username',
]);

function frozen(outcome, extra = {}) {
  return Object.freeze({ outcome, ...extra });
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isBoundedString(value, maximumCodePoints) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].length <= maximumCodePoints
  );
}

function hasExactKeys(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function hasOnlyAllowedKeys(value, required, optional = []) {
  const keys = Object.keys(value);
  return (
    required.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isUnixEpochSeconds(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isMatchId(value) {
  return typeof value === 'string' && INTERNAL_UUID_PATTERN.test(value);
}

function isOptionalSafePrice(value) {
  if (value === undefined) return true;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 1_000_000
  ) {
    return false;
  }
  return Number(value.toFixed(2)) === value;
}

function isOptionalMatchTitle(value) {
  return value === undefined || isBoundedString(value, 160);
}

function isMatchRating(value) {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

export function isBackendCreateMatchDraft(value) {
  if (
    !isPlainObject(value) ||
    !hasOnlyAllowedKeys(
      value,
      MATCH_CREATE_REQUIRED_KEYS,
      MATCH_CREATE_OPTIONAL_KEYS,
    ) ||
    !isUnixEpochSeconds(value.startsAt) ||
    !MATCH_DURATIONS.includes(value.durationMinutes) ||
    !MATCH_SCENARIOS.includes(value.scenario) ||
    (value.courtId !== undefined &&
      (!isBoundedString(value.courtId, 64) ||
        value.courtId.trim() !== value.courtId)) ||
    !isOptionalMatchTitle(value.title) ||
    (value.title !== undefined && value.title.trim() !== value.title) ||
    typeof value.description !== 'string' ||
    [...value.description].length > 2_000 ||
    typeof value.isRatingMatch !== 'boolean'
  ) {
    return false;
  }

  if (value.scenario === 'private') {
    return (
      value.courtId !== undefined &&
      value.isRatingMatch === false &&
      !Object.prototype.hasOwnProperty.call(value, 'ratingMin') &&
      !Object.prototype.hasOwnProperty.call(value, 'ratingMax')
    );
  }

  return (
    (value.scenario !== 'social' || value.courtId !== undefined) &&
    isMatchRating(value.ratingMin) &&
    isMatchRating(value.ratingMax) &&
    value.ratingMin <= value.ratingMax
  );
}

function isBackendMatchPublicPlayer(value, slotRequired = false) {
  if (
    !isPlainObject(value) ||
    !hasOnlyAllowedKeys(
      value,
      [
        'playerId',
        'firstName',
        'rating',
        'isVerified',
        ...(slotRequired ? ['slotNumber'] : []),
      ],
      ['lastName', 'username'],
    ) ||
    !isMatchId(value.playerId) ||
    !isBoundedString(value.firstName, 256) ||
    (value.lastName !== undefined &&
      !isBoundedString(value.lastName, 256)) ||
    (value.username !== undefined &&
      !isBoundedString(value.username, 64)) ||
    !isRating(value.rating) ||
    Number(value.rating.toFixed(2)) !== value.rating ||
    typeof value.isVerified !== 'boolean'
  ) {
    return false;
  }
  return !slotRequired || [2, 3, 4].includes(value.slotNumber);
}

function isBackendPublicPlayer(value) {
  return (
    isPlainObject(value) &&
    hasExactKeys(
      Object.keys(value).sort(),
      [
        'firstName',
        'isVerified',
        'lastName',
        'playerId',
        'rating',
        'username',
      ],
    ) &&
    isMatchId(value.playerId) &&
    isBoundedString(value.firstName, 256) &&
    (value.lastName === null || isBoundedString(value.lastName, 256)) &&
    (value.username === null || isBoundedString(value.username, 64)) &&
    isRating(value.rating) &&
    typeof value.isVerified === 'boolean'
  );
}

function isBackendMatchInvitationMatch(value) {
  if (
    !isPlainObject(value) ||
    !hasOnlyAllowedKeys(
      value,
      [
        'matchId',
        'ownerAccountId',
        'startsAt',
        'durationMinutes',
        'courtId',
        'courtName',
        'courtType',
        'scenario',
        'status',
        'isRatingMatch',
        'owner',
      ],
      [
        'title',
        'ratingMin',
        'ratingMax',
        'pricePerPersonSnapshot',
      ],
    ) ||
    !isMatchId(value.matchId) ||
    !isMatchId(value.ownerAccountId) ||
    !isUnixEpochSeconds(value.startsAt) ||
    !MATCH_DURATIONS.includes(value.durationMinutes) ||
    typeof value.courtId !== 'string' ||
    typeof value.courtName !== 'string' ||
    typeof value.courtType !== 'string' ||
    !MATCH_SCENARIOS.includes(value.scenario) ||
    !MATCH_STATUSES.includes(value.status) ||
    !isOptionalMatchTitle(value.title) ||
    typeof value.isRatingMatch !== 'boolean' ||
    !isOptionalSafePrice(value.pricePerPersonSnapshot) ||
    !isBackendMatchPublicPlayer(value.owner) ||
    value.owner.playerId !== value.ownerAccountId
  ) {
    return false;
  }
  if (value.scenario === 'private') {
    return value.ratingMin === undefined && value.ratingMax === undefined;
  }
  return (
    isMatchRating(value.ratingMin) &&
    isMatchRating(value.ratingMax) &&
    value.ratingMin <= value.ratingMax
  );
}

export function isBackendMatchInvitation(value) {
  return (
    isPlainObject(value) &&
    hasOnlyAllowedKeys(
      value,
      [
        'invitationId',
        'matchId',
        'invitedByAccountId',
        'invitedAccountId',
        'slotNumber',
        'status',
        'createdAt',
        'updatedAt',
        'version',
        'match',
        'invitedPlayer',
      ],
      ['respondedAt'],
    ) &&
    isMatchId(value.invitationId) &&
    isMatchId(value.matchId) &&
    isMatchId(value.invitedByAccountId) &&
    isMatchId(value.invitedAccountId) &&
    [2, 3, 4].includes(value.slotNumber) &&
    MATCH_INVITATION_STATUSES.includes(value.status) &&
    isUnixEpochSeconds(value.createdAt) &&
    isUnixEpochSeconds(value.updatedAt) &&
    value.updatedAt >= value.createdAt &&
    (value.respondedAt === undefined ||
      isUnixEpochSeconds(value.respondedAt)) &&
    (
      (value.status === 'pending' && value.respondedAt === undefined) ||
      (value.status !== 'pending' && value.respondedAt !== undefined)
    ) &&
    Number.isSafeInteger(value.version) &&
    value.version >= 1 &&
    isBackendMatchInvitationMatch(value.match) &&
    value.match.matchId === value.matchId &&
    value.match.ownerAccountId === value.invitedByAccountId &&
    isBackendMatchPublicPlayer(value.invitedPlayer) &&
    value.invitedPlayer.playerId === value.invitedAccountId
  );
}

function isBackendMatchParticipantIdentity(value) {
  return (
    isPlainObject(value) &&
    hasExactKeys(
      Object.keys(value).sort(),
      ['playerId', 'slotNumber'],
    ) &&
    isMatchId(value.playerId) &&
    [2, 3, 4].includes(value.slotNumber)
  );
}

export function isBackendMatchFeedRecord(value) {
  if (
    !(
      isPlainObject(value) &&
      hasOnlyAllowedKeys(
        value,
        [
          'matchId',
          'ownerAccountId',
          'startsAt',
          'durationMinutes',
          'courtId',
          'courtName',
          'courtType',
          'scenario',
          'status',
          'ratingMin',
          'ratingMax',
          'isRatingMatch',
          'occupiedSlots',
          'version',
        ],
        [
          'title',
          'pricePerPersonSnapshot',
          'owner',
          'participants',
        ],
      ) &&
      isMatchId(value.matchId) &&
      isMatchId(value.ownerAccountId) &&
      isUnixEpochSeconds(value.startsAt) &&
      MATCH_DURATIONS.includes(value.durationMinutes) &&
      typeof value.courtId === 'string' &&
      typeof value.courtName === 'string' &&
      typeof value.courtType === 'string' &&
      (value.scenario === 'community' ||
        value.scenario === 'social') &&
      MATCH_FEED_STATUSES.includes(value.status) &&
      isOptionalMatchTitle(value.title) &&
      isMatchRating(value.ratingMin) &&
      isMatchRating(value.ratingMax) &&
      value.ratingMin <= value.ratingMax &&
      typeof value.isRatingMatch === 'boolean' &&
      isOptionalSafePrice(value.pricePerPersonSnapshot) &&
      Number.isInteger(value.occupiedSlots) &&
      value.occupiedSlots >= 1 &&
      value.occupiedSlots <= 4 &&
      Number.isSafeInteger(value.version) &&
      value.version >= 1
    )
  ) {
    return false;
  }
  const hasOwner = value.owner !== undefined;
  const hasParticipants = value.participants !== undefined;
  if (!hasOwner && !hasParticipants) {
    return true;
  }
  if (!hasOwner || !hasParticipants) {
    return false;
  }
  if (
    !isBackendMatchPublicPlayer(value.owner) ||
    value.owner.playerId !== value.ownerAccountId ||
    !Array.isArray(value.participants) ||
    value.participants.length > 3 ||
    !value.participants.every((participant) =>
      isBackendMatchPublicPlayer(participant, true))
  ) {
    return false;
  }
  const playerIds = value.participants.map(({ playerId }) => playerId);
  const slotNumbers = value.participants.map(
    ({ slotNumber }) => slotNumber,
  );
  return (
    value.occupiedSlots === value.participants.length + 1 &&
    !playerIds.includes(value.ownerAccountId) &&
    new Set(playerIds).size === playerIds.length &&
    new Set(slotNumbers).size === slotNumbers.length
  );
}

export function isBackendMatchDetailRecord(value) {
  if (
    !isPlainObject(value) ||
    !hasOnlyAllowedKeys(
      value,
      [
        'matchId',
        'ownerAccountId',
        'createdAt',
        'updatedAt',
        'startsAt',
        'durationMinutes',
        'courtId',
        'courtName',
        'courtType',
        'kind',
        'visibility',
        'scenario',
        'status',
        'description',
        'isRatingMatch',
        'version',
        'participants',
      ],
      [
        'title',
        'ratingMin',
        'ratingMax',
        'pricePerPersonSnapshot',
        'terminalAt',
        'owner',
      ],
    ) ||
    !isMatchId(value.matchId) ||
    !isMatchId(value.ownerAccountId) ||
    !isUnixEpochSeconds(value.createdAt) ||
    !isUnixEpochSeconds(value.updatedAt) ||
    !isUnixEpochSeconds(value.startsAt) ||
    !MATCH_DURATIONS.includes(value.durationMinutes) ||
    typeof value.courtId !== 'string' ||
    typeof value.courtName !== 'string' ||
    typeof value.courtType !== 'string' ||
    (value.kind !== 'match' && value.kind !== 'private') ||
    (value.visibility !== 'public' && value.visibility !== 'private') ||
    !MATCH_SCENARIOS.includes(value.scenario) ||
    !MATCH_STATUSES.includes(value.status) ||
    !isOptionalMatchTitle(value.title) ||
    typeof value.description !== 'string' ||
    [...value.description].length > 2_000 ||
    typeof value.isRatingMatch !== 'boolean' ||
    !isOptionalSafePrice(value.pricePerPersonSnapshot) ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    (value.terminalAt !== undefined &&
      !isUnixEpochSeconds(value.terminalAt)) ||
    !Array.isArray(value.participants) ||
    value.participants.length > 3
  ) {
    return false;
  }

  const hasPublicProjection = value.owner !== undefined;
  const participantsValid = value.participants.every((participant) =>
    hasPublicProjection
      ? isBackendMatchPublicPlayer(participant, true)
      : isBackendMatchParticipantIdentity(participant));
  if (!participantsValid) return false;

  const playerIds = value.participants.map(({ playerId }) => playerId);
  const slotNumbers = value.participants.map(({ slotNumber }) => slotNumber);
  if (
    (hasPublicProjection &&
      (
        !isBackendMatchPublicPlayer(value.owner) ||
        value.owner.playerId !== value.ownerAccountId
      )) ||
    playerIds.includes(value.ownerAccountId) ||
    new Set(playerIds).size !== playerIds.length ||
    new Set(slotNumbers).size !== slotNumbers.length
  ) {
    return false;
  }

  if (value.scenario === 'private') {
    return (
      value.kind === 'private' &&
      value.visibility === 'private' &&
      value.isRatingMatch === false &&
      value.ratingMin === undefined &&
      value.ratingMax === undefined
    );
  }

  return (
    value.kind === 'match' &&
    value.visibility === 'public' &&
    isMatchRating(value.ratingMin) &&
    isMatchRating(value.ratingMax) &&
    value.ratingMin <= value.ratingMax
  );
}

function isBackendMatchParticipant(value, status) {
  return (
    isPlainObject(value) &&
    hasExactKeys(
      Object.keys(value).sort(),
      ['matchId', 'matchVersion', 'playerId', 'slotNumber', 'status'],
    ) &&
    isMatchId(value.matchId) &&
    isMatchId(value.playerId) &&
    [2, 3, 4].includes(value.slotNumber) &&
    value.status === status &&
    Number.isSafeInteger(value.matchVersion) &&
    value.matchVersion >= 1
  );
}

function isRating(value) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 10
  ) {
    return false;
  }
  const scaled = value * 100;
  const tolerance =
    Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  return Math.abs(scaled - Math.round(scaled)) <= tolerance;
}

function isNullableBoundedString(value, maximumCodePoints) {
  return value === null || isBoundedString(value, maximumCodePoints);
}

function exactPublicCode(body) {
  return isPlainObject(body) && typeof body.code === 'string'
    ? body.code
    : '';
}

function cancelReader(reader) {
  try {
    const cancellation = reader.cancel();
    if (cancellation && typeof cancellation.catch === 'function') {
      void cancellation.catch(() => {});
    }
  } catch {
    // Cancellation is best-effort after abort.
  }
}

function waitForRead(readPromise, signal, reader) {
  if (signal.aborted) {
    cancelReader(reader);
    return Promise.reject(BODY_ABORTED);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      callback(value);
    };
    const handleAbort = () => {
      cancelReader(reader);
      finish(reject, BODY_ABORTED);
    };

    signal.addEventListener('abort', handleAbort, { once: true });
    readPromise.then(
      (value) => finish(resolve, value),
      () => finish(
        reject,
        signal.aborted ? BODY_ABORTED : BODY_NETWORK_FAILURE,
      ),
    );
  });
}

async function readBoundedJson(
  response,
  signal,
  maximumBytes = MAX_RESPONSE_BODY_BYTES,
) {
  const declaredLength = response.headers?.get?.('content-length');
  if (declaredLength !== null && declaredLength !== undefined) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > maximumBytes
    ) {
      try {
        const cancellation = response.body?.cancel?.();
        if (cancellation && typeof cancellation.catch === 'function') {
          void cancellation.catch(() => {});
        }
      } catch {
        // The response is rejected regardless of cleanup.
      }
      throw BODY_INVALID;
    }
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw BODY_INVALID;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let totalBytes = 0;
  let text = '';

  try {
    while (true) {
      const chunk = await waitForRead(reader.read(), signal, reader);
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) throw BODY_INVALID;

      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        cancelReader(reader);
        throw BODY_INVALID;
      }
      try {
        text += decoder.decode(chunk.value, { stream: true });
      } catch {
        throw BODY_INVALID;
      }
    }
    try {
      text += decoder.decode();
      return JSON.parse(text);
    } catch {
      throw BODY_INVALID;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The body may already be cancelled.
    }
  }
}

function createRequestKey(cryptoImpl) {
  if (!cryptoImpl || typeof cryptoImpl.randomUUID !== 'function') return null;
  try {
    const requestKey = cryptoImpl.randomUUID();
    return typeof requestKey === 'string' && UUID_PATTERN.test(requestKey)
      ? requestKey
      : null;
  } catch {
    return null;
  }
}

function defaultSleep(delayMs, signal) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (completed) => {
      if (settled) return;
      settled = true;
      if (timer !== null) globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', handleAbort);
      resolve(completed);
    };
    const handleAbort = () => finish(false);

    if (signal?.aborted) {
      finish(false);
      return;
    }
    signal?.addEventListener('abort', handleAbort, { once: true });
    timer = globalThis.setTimeout(() => finish(true), delayMs);
  });
}

function retryDelayMs(retryNumber, random) {
  const ceiling = Math.min(
    BACKOFF_MAX_MS,
    BACKOFF_BASE_MS * (2 ** retryNumber),
  );
  const half = ceiling / 2;
  return Math.floor(
    half + (Math.max(0, Math.min(1, random())) * half),
  );
}

function refreshSuccess(body) {
  if (!isPlainObject(body)) return null;
  const keys = Object.keys(body).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== 'credential' ||
    keys[1] !== 'expiresAt' ||
    !isCanonicalSessionCredential(body.credential) ||
    !Number.isSafeInteger(body.expiresAt) ||
    body.expiresAt <= Math.floor(Date.now() / 1_000)
  ) {
    return null;
  }
  return frozen('refreshed', {
    credential: body.credential,
    expiresAt: body.expiresAt,
  });
}

function authenticationSuccess(body) {
  if (!isPlainObject(body)) return null;
  const keys = Object.keys(body).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'accountId' ||
    keys[1] !== 'expiresAt' ||
    keys[2] !== 'role' ||
    !INTERNAL_UUID_PATTERN.test(body.accountId) ||
    (body.role !== 'player' && body.role !== 'club_admin') ||
    !Number.isSafeInteger(body.expiresAt) ||
    body.expiresAt <= Math.floor(Date.now() / 1_000)
  ) {
    return null;
  }
  return frozen('authenticated', {
    principal: Object.freeze({
      accountId: body.accountId,
      role: body.role,
      expiresAt: body.expiresAt,
    }),
  });
}

export function isBackendOwnProfile(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  const hasRatingState = hasExactKeys(keys, RATING_PROFILE_KEYS);
  if (
    (!hasRatingState && !hasExactKeys(keys, LEGACY_PROFILE_KEYS)) ||
    !INTERNAL_UUID_PATTERN.test(value.accountId) ||
    value.role !== 'player' ||
    !isBoundedString(value.firstName, 256) ||
    !isNullableBoundedString(value.lastName, 256) ||
    !isNullableBoundedString(value.username, 64) ||
    !isNullableBoundedString(value.photoUrl, 2_048) ||
    !isNullableBoundedString(value.languageCode, 64) ||
    (value.phone !== null &&
      (typeof value.phone !== 'string' ||
        !PHONE_PATTERN.test(value.phone))) ||
    (value.sidePreference !== null &&
      !SIDE_PREFERENCES.includes(value.sidePreference)) ||
    (hasRatingState &&
      (!isRating(value.rating) ||
        typeof value.isVerified !== 'boolean'))
  ) {
    return false;
  }
  if (value.photoUrl !== null) {
    try {
      if (new URL(value.photoUrl).protocol !== 'https:') return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function isBackendOwnProfilePatch(value) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => PROFILE_PATCH_KEYS.includes(key)) &&
    (!Object.prototype.hasOwnProperty.call(value, 'firstName') ||
      (isBoundedString(value.firstName, 256) &&
        value.firstName.trim() === value.firstName)) &&
    (!Object.prototype.hasOwnProperty.call(value, 'lastName') ||
      value.lastName === null ||
      (isBoundedString(value.lastName, 256) &&
        value.lastName.trim() === value.lastName)) &&
    (!Object.prototype.hasOwnProperty.call(value, 'phone') ||
      value.phone === null ||
      (typeof value.phone === 'string' &&
        PHONE_PATTERN.test(value.phone))) &&
    (!Object.prototype.hasOwnProperty.call(value, 'sidePreference') ||
      SIDE_PREFERENCES.includes(value.sidePreference))
  );
}

function profileSuccess(body, outcome = 'profile_loaded') {
  if (!isBackendOwnProfile(body)) return null;
  return frozen(outcome, {
    profile: Object.freeze({
      accountId: body.accountId,
      role: body.role,
      firstName: body.firstName,
      lastName: body.lastName,
      username: body.username,
      photoUrl: body.photoUrl,
      languageCode: body.languageCode,
      phone: body.phone,
      sidePreference: body.sidePreference,
      ...(Object.prototype.hasOwnProperty.call(body, 'rating')
        ? {
            rating: body.rating,
            isVerified: body.isVerified,
          }
        : {}),
    }),
  });
}

function freezeBackendMatchRecord(match) {
  return Object.freeze({
    ...match,
    ...(match.owner === undefined
      ? {}
      : { owner: Object.freeze({ ...match.owner }) }),
    ...(match.participants === undefined
      ? {}
      : {
          participants: Object.freeze(
            match.participants.map((participant) =>
              Object.freeze({ ...participant })),
          ),
        }),
  });
}

function matchListSuccess(body) {
  if (
    !isPlainObject(body) ||
    !hasExactKeys(Object.keys(body).sort(), ['matches']) ||
    !Array.isArray(body.matches) ||
    body.matches.length > 50 ||
    !body.matches.every(isBackendMatchFeedRecord)
  ) {
    return null;
  }
  return frozen('matches_loaded', {
    matches: Object.freeze(
      body.matches.map(freezeBackendMatchRecord),
    ),
  });
}

function matchDetailSuccess(body, outcome) {
  if (
    !isPlainObject(body) ||
    !hasExactKeys(Object.keys(body).sort(), ['match']) ||
    !isBackendMatchDetailRecord(body.match)
  ) {
    return null;
  }
  return frozen(outcome, {
    match: freezeBackendMatchRecord(body.match),
  });
}

function matchParticipantSuccess(body, outcome, status) {
  if (
    !isPlainObject(body) ||
    !hasExactKeys(Object.keys(body).sort(), ['participant']) ||
    !isBackendMatchParticipant(body.participant, status)
  ) {
    return null;
  }
  return frozen(outcome, {
    participant: Object.freeze({ ...body.participant }),
  });
}

function playerSearchSuccess(body, maximumLength = 20) {
  if (
    !isPlainObject(body) ||
    !hasExactKeys(Object.keys(body).sort(), ['players']) ||
    !Array.isArray(body.players) ||
    body.players.length > maximumLength ||
    !body.players.every(isBackendPublicPlayer) ||
    new Set(body.players.map(({ playerId }) => playerId)).size !==
      body.players.length
  ) {
    return null;
  }
  return frozen('players_loaded', {
    players: Object.freeze(
      body.players.map((player) => Object.freeze({ ...player })),
    ),
  });
}

function freezeBackendMatchInvitation(invitation) {
  return Object.freeze({
    ...invitation,
    match: Object.freeze({
      ...invitation.match,
      owner: Object.freeze({ ...invitation.match.owner }),
    }),
    invitedPlayer: Object.freeze({ ...invitation.invitedPlayer }),
  });
}

function matchInvitationListSuccess(body, maximumLength = 20) {
  if (
    !isPlainObject(body) ||
    !hasExactKeys(Object.keys(body).sort(), ['invitations']) ||
    !Array.isArray(body.invitations) ||
    body.invitations.length > maximumLength ||
    !body.invitations.every(isBackendMatchInvitation) ||
    body.invitations.some(({ status }) => status !== 'pending') ||
    new Set(body.invitations.map(({ invitationId }) => invitationId)).size !==
      body.invitations.length
  ) {
    return null;
  }
  return frozen('invitations_loaded', {
    invitations: Object.freeze(
      body.invitations.map(freezeBackendMatchInvitation),
    ),
  });
}

function matchInvitationSuccess(body, outcome, status) {
  if (
    !isPlainObject(body) ||
    !hasExactKeys(Object.keys(body).sort(), ['invitation']) ||
    !isBackendMatchInvitation(body.invitation) ||
    body.invitation.status !== status
  ) {
    return null;
  }
  return frozen(outcome, {
    invitation: freezeBackendMatchInvitation(body.invitation),
  });
}

function acceptedMatchInvitationSuccess(body) {
  if (
    !isPlainObject(body) ||
    !hasExactKeys(
      Object.keys(body).sort(),
      ['invitation', 'matchVersion', 'participant'],
    ) ||
    !isBackendMatchInvitation(body.invitation) ||
    body.invitation.status !== 'accepted' ||
    !isPlainObject(body.participant) ||
    !hasExactKeys(
      Object.keys(body.participant).sort(),
      ['accountId', 'participantId', 'slotNumber', 'status'],
    ) ||
    !isMatchId(body.participant.participantId) ||
    !isMatchId(body.participant.accountId) ||
    ![2, 3, 4].includes(body.participant.slotNumber) ||
    body.participant.status !== 'active' ||
    body.participant.accountId !== body.invitation.invitedAccountId ||
    body.participant.slotNumber !== body.invitation.slotNumber ||
    !Number.isSafeInteger(body.matchVersion) ||
    body.matchVersion < 1
  ) {
    return null;
  }
  return frozen('invitation_accepted', {
    invitation: freezeBackendMatchInvitation(body.invitation),
    participant: Object.freeze({ ...body.participant }),
    matchVersion: body.matchVersion,
  });
}

function classifyRefresh(status, body) {
  const code = exactPublicCode(body);
  if (status === 401 && code === 'session_expired') {
    return frozen('rejected', { reason: 'expired' });
  }
  if (status === 401 && code === 'session_invalid') {
    return frozen('rejected', { reason: 'invalid' });
  }
  if (status === 409 && code === 'session_refresh_reopen_required') {
    return frozen('rejected', { reason: 'reopen_required' });
  }
  if (status === 409 && code === 'session_request_conflict') {
    return frozen('rejected', { reason: 'conflict' });
  }
  return frozen('rejected', { reason: 'internal_error' });
}

function classifyLogout(status, body) {
  const code = exactPublicCode(body);
  if (status === 401 && code === 'session_invalid') {
    return frozen('rejected', { reason: 'invalid' });
  }
  if (status === 409 && code === 'session_request_conflict') {
    return frozen('rejected', { reason: 'conflict' });
  }
  return frozen('rejected', { reason: 'internal_error' });
}

function classifyAuthentication(status, body) {
  const code = exactPublicCode(body);
  if (status === 401 && code === 'session_invalid') {
    return frozen('rejected', { reason: 'invalid' });
  }
  return frozen('rejected', { reason: 'internal_error' });
}

function classifyProfile(status, body) {
  const code = exactPublicCode(body);
  if (status === 401 && code === 'session_invalid') {
    return frozen('rejected', { reason: 'invalid' });
  }
  if (status === 404 && code === 'profile_not_found') {
    return frozen('rejected', { reason: 'profile_not_found' });
  }
  if (status === 400 && code === 'profile_invalid_request') {
    return frozen('rejected', { reason: 'invalid_request' });
  }
  return frozen('rejected', { reason: 'internal_error' });
}

function classifyMatch(status, body) {
  const code = exactPublicCode(body);
  if (status === 401 && code === 'session_invalid') {
    return frozen('rejected', { reason: 'invalid' });
  }
  const reasons = Object.freeze({
    match_invalid_request: 'invalid_request',
    match_forbidden: 'forbidden',
    match_not_found: 'match_not_found',
    match_closed: 'match_closed',
    match_not_joinable: 'match_not_joinable',
    match_started: 'match_started',
    match_rating_verification_required: 'rating_verification_required',
    match_rating_out_of_range: 'rating_out_of_range',
    match_owner_cannot_join: 'owner_cannot_join',
    match_already_joined: 'already_joined',
    match_full: 'match_full',
    match_participant_not_active: 'participant_not_active',
    match_request_conflict: 'request_conflict',
    match_conflict: 'match_conflict',
  });
  return frozen('rejected', {
    reason: reasons[code] ?? 'internal_error',
  });
}

function classifyPlayerSearch(status, body) {
  const code = exactPublicCode(body);
  if (status === 401 && code === 'session_invalid') {
    return frozen('rejected', { reason: 'invalid' });
  }
  if (status === 400 && code === 'player_search_invalid_request') {
    return frozen('rejected', { reason: 'invalid_request' });
  }
  return frozen('rejected', { reason: 'internal_error' });
}

function classifyMatchInvitation(status, body) {
  const code = exactPublicCode(body);
  if (status === 401 && code === 'session_invalid') {
    return frozen('rejected', { reason: 'invalid' });
  }
  const reasons = Object.freeze({
    match_invitation_invalid_request: 'invalid_request',
    match_invitation_forbidden: 'forbidden',
    match_invitation_not_found: 'invitation_not_found',
    match_invitation_closed: 'invitation_closed',
    match_not_found: 'match_not_found',
    match_closed: 'match_closed',
    match_started: 'match_started',
    match_full: 'match_full',
    match_invitation_slot_unavailable: 'slot_unavailable',
    match_invitation_already_participant: 'already_participant',
    match_invitation_already_pending: 'already_invited',
    match_invitation_player_not_found: 'player_not_found',
    match_rating_verification_required: 'rating_verification_required',
    match_rating_out_of_range: 'rating_out_of_range',
    match_invitation_request_conflict: 'request_conflict',
    match_conflict: 'match_conflict',
  });
  return frozen('rejected', {
    reason: reasons[code] ?? 'internal_error',
  });
}

export function createBackendSessionClient(dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const cryptoImpl = dependencies.cryptoImpl ?? globalThis.crypto;
  const sleep = dependencies.sleep ?? defaultSleep;
  const random = dependencies.random ?? Math.random;
  const requestTimeoutMs =
    dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  async function requestOnce(
    operation,
    credential,
    requestKey,
    externalSignal,
    operationPayload,
  ) {
    if (
      typeof fetchImpl !== 'function' ||
      typeof AbortController !== 'function' ||
      !Number.isFinite(requestTimeoutMs) ||
      requestTimeoutMs <= 0
    ) {
      return frozen('configuration_failure');
    }
    if (externalSignal?.aborted) return frozen('cancelled');

    const controller = new AbortController();
    let timedOut = false;
    const handleExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', handleExternalAbort, {
      once: true,
    });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);

    try {
      const isMatchOperation = operation.startsWith('match_');
      const isMatchInvitationOperation =
        operation.startsWith('match_invitation_');
      const isPlayerSearchOperation = operation === 'player_search';
      const isReadOnly =
        operation === 'authenticate' ||
        operation === 'profile' ||
        operation === 'match_list' ||
        operation === 'match_detail' ||
        operation === 'player_search' ||
        operation === 'match_invitation_incoming' ||
        operation === 'match_invitation_outgoing';
      const isProfileOperation =
        operation === 'profile' || operation === 'profile_update';
      const matchId = operationPayload?.matchId;
      const url =
        operation === 'refresh'
          ? REFRESH_PATH
          : operation === 'logout'
            ? LOGOUT_PATH
            : isProfileOperation
              ? PROFILE_PATH
              : operation === 'match_list'
                ? `${MATCHES_PATH}?limit=${operationPayload.limit}`
                : operation === 'player_search'
                  ? `${PLAYER_SEARCH_PATH}?q=${encodeURIComponent(operationPayload.query)}&limit=${operationPayload.limit}`
                  : operation === 'match_invitation_incoming'
                    ? `${MATCH_INVITATIONS_PATH}?limit=${operationPayload.limit}`
                    : operation === 'match_invitation_outgoing'
                      ? `${MATCHES_PATH}/${encodeURIComponent(matchId)}/invitations?limit=${operationPayload.limit}`
                : operation === 'match_detail'
                  ? `${MATCHES_PATH}/${encodeURIComponent(matchId)}`
                  : operation === 'match_create'
                    ? MATCHES_PATH
                    : operation === 'match_invitation_create'
                      ? `${MATCHES_PATH}/${encodeURIComponent(matchId)}/invitations`
                      : operation === 'match_invitation_accept'
                        ? `${MATCH_INVITATIONS_PATH}/${encodeURIComponent(operationPayload.invitationId)}/accept`
                        : operation === 'match_invitation_decline'
                          ? `${MATCH_INVITATIONS_PATH}/${encodeURIComponent(operationPayload.invitationId)}/decline`
                          : operation === 'match_invitation_cancel'
                            ? `${MATCH_INVITATIONS_PATH}/${encodeURIComponent(operationPayload.invitationId)}/cancel`
                    : operation === 'match_join'
                      ? `${MATCHES_PATH}/${encodeURIComponent(matchId)}/join`
                      : operation === 'match_leave'
                        ? `${MATCHES_PATH}/${encodeURIComponent(matchId)}/leave`
                        : AUTHENTICATE_PATH;
      const response = await fetchImpl(
        url,
        {
          method:
            isReadOnly
              ? 'GET'
              : operation === 'profile_update'
                ? 'PATCH'
                : 'POST',
          headers: isReadOnly
            ? {
                Accept: 'application/json',
                Authorization: `Bearer ${credential}`,
              }
            : {
                Accept: 'application/json',
                Authorization: `Bearer ${credential}`,
                'Content-Type': 'application/json',
              },
          ...(isReadOnly
            ? {}
            : {
                body: JSON.stringify(
                  operation === 'profile_update'
                    ? operationPayload
                    : operation === 'match_create'
                      ? { ...operationPayload, requestKey }
                      : operation === 'match_invitation_create'
                        ? {
                            requestKey,
                            playerId: operationPayload.playerId,
                            slotNumber: operationPayload.slotNumber,
                          }
                      : { requestKey },
                ),
              }),
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
        },
      );

      if (operation === 'logout' && response.status === 204) {
        return frozen('success', { result: frozen('logged_out') });
      }

      const body = await readBoundedJson(
        response,
        controller.signal,
        operation === 'match_list'
          ? MAX_MATCH_FEED_RESPONSE_BODY_BYTES
          : isPlayerSearchOperation
            ? MAX_PLAYER_SEARCH_RESPONSE_BODY_BYTES
            : isMatchInvitationOperation
              ? MAX_MATCH_INVITATION_RESPONSE_BODY_BYTES
              : MAX_RESPONSE_BODY_BYTES,
      );
      if (operation === 'authenticate' && response.status === 200) {
        const result = authenticationSuccess(body);
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (operation === 'profile' && response.status === 200) {
        const result = profileSuccess(body);
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (operation === 'profile_update' && response.status === 200) {
        const result = profileSuccess(body, 'profile_updated');
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (operation === 'match_list' && response.status === 200) {
        const result = matchListSuccess(body);
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (operation === 'player_search' && response.status === 200) {
        const result = playerSearchSuccess(
          body,
          operationPayload.limit,
        );
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (
        (operation === 'match_invitation_incoming' ||
          operation === 'match_invitation_outgoing') &&
        response.status === 200
      ) {
        const result = matchInvitationListSuccess(
          body,
          operationPayload.limit,
        );
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (
        operation === 'match_invitation_create' &&
        response.status === 201
      ) {
        const result = matchInvitationSuccess(
          body,
          'invitation_created',
          'pending',
        );
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (
        (operation === 'match_invitation_decline' ||
          operation === 'match_invitation_cancel') &&
        response.status === 201
      ) {
        const result = matchInvitationSuccess(
          body,
          operation === 'match_invitation_decline'
            ? 'invitation_declined'
            : 'invitation_cancelled',
          operation === 'match_invitation_decline'
            ? 'declined'
            : 'cancelled',
        );
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (
        operation === 'match_invitation_accept' &&
        response.status === 201
      ) {
        const result = acceptedMatchInvitationSuccess(body);
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (
        (operation === 'match_detail' || operation === 'match_create') &&
        response.status === (
          operation === 'match_create' ? 201 : 200
        )
      ) {
        const result = matchDetailSuccess(
          body,
          operation === 'match_create' ? 'match_created' : 'match_loaded',
        );
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (operation === 'match_join' && response.status === 200) {
        const result = matchParticipantSuccess(
          body,
          'participant_joined',
          'active',
        );
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (operation === 'match_leave' && response.status === 200) {
        const result = matchParticipantSuccess(
          body,
          'participant_left',
          'left',
        );
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (operation === 'refresh' && response.status === 200) {
        const result = refreshSuccess(body);
        return result
          ? frozen('success', { result })
          : frozen('malformed_response');
      }
      if (
        response.status === 503 &&
        exactPublicCode(body) === (
          isProfileOperation
            ? 'profile_service_unavailable'
            : isPlayerSearchOperation
              ? 'player_search_unavailable'
              : isMatchInvitationOperation
                ? 'match_invitation_service_unavailable'
            : isMatchOperation
              ? 'match_service_unavailable'
              : 'session_service_unavailable'
        )
      ) {
        return frozen('retryable_unavailable');
      }
      return frozen('success', {
        result:
          operation === 'refresh'
            ? classifyRefresh(response.status, body)
            : operation === 'logout'
              ? classifyLogout(response.status, body)
              : isProfileOperation
                ? classifyProfile(response.status, body)
                : isPlayerSearchOperation
                  ? classifyPlayerSearch(response.status, body)
                  : isMatchInvitationOperation
                    ? classifyMatchInvitation(response.status, body)
                : isMatchOperation
                  ? classifyMatch(response.status, body)
                  : classifyAuthentication(response.status, body),
      });
    } catch (error) {
      if (externalSignal?.aborted) return frozen('cancelled');
      if (timedOut || error === BODY_ABORTED) return frozen('request_timeout');
      if (error === BODY_INVALID) return frozen('malformed_response');
      if (error === BODY_NETWORK_FAILURE) return frozen('network_failure');
      return frozen('network_failure');
    } finally {
      globalThis.clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', handleExternalAbort);
    }
  }

  async function execute(
    operation,
    credential,
    options = {},
    operationPayload,
  ) {
    const externalSignal = options.signal;
    if (!isCanonicalSessionCredential(credential)) {
      return frozen('rejected', { reason: 'invalid' });
    }
    if (externalSignal?.aborted) return frozen('cancelled');
    if (
      operation === 'profile_update' &&
      !isBackendOwnProfilePatch(operationPayload)
    ) {
      return frozen('rejected', { reason: 'invalid_request' });
    }
    if (
      (operation === 'match_list' &&
        (!Number.isInteger(operationPayload?.limit) ||
          operationPayload.limit < 1 ||
          operationPayload.limit > 50)) ||
      ((operation === 'match_detail' ||
        operation === 'match_join' ||
        operation === 'match_leave') &&
        !isMatchId(operationPayload?.matchId)) ||
      (operation === 'match_create' &&
        !isBackendCreateMatchDraft(operationPayload)) ||
      (operation === 'player_search' &&
        (
          typeof operationPayload?.query !== 'string' ||
          [...operationPayload.query.normalize('NFKC').trim().replace(/^@/u, '').trim()].length < 2 ||
          [...operationPayload.query.normalize('NFKC').trim().replace(/^@/u, '').trim()].length > 64 ||
          CONTROL_CHARACTER_PATTERN.test(
            operationPayload.query.normalize('NFKC'),
          ) ||
          !Number.isInteger(operationPayload.limit) ||
          operationPayload.limit < 1 ||
          operationPayload.limit > 20
        )) ||
      ((operation === 'match_invitation_incoming' ||
        operation === 'match_invitation_outgoing') &&
        (
          (operation === 'match_invitation_outgoing' &&
            !isMatchId(operationPayload?.matchId)) ||
          !Number.isInteger(operationPayload?.limit) ||
          operationPayload.limit < 1 ||
          operationPayload.limit > 20
        )) ||
      (operation === 'match_invitation_create' &&
        (
          !isMatchId(operationPayload?.matchId) ||
          !isMatchId(operationPayload?.playerId) ||
          ![2, 3, 4].includes(operationPayload?.slotNumber)
        )) ||
      ((operation === 'match_invitation_accept' ||
        operation === 'match_invitation_decline' ||
        operation === 'match_invitation_cancel') &&
        !isMatchId(operationPayload?.invitationId))
    ) {
      return frozen('rejected', { reason: 'invalid_request' });
    }

    const requiresRequestKey =
      operation === 'refresh' ||
      operation === 'logout' ||
      operation === 'match_create' ||
      operation === 'match_join' ||
      operation === 'match_leave' ||
      operation === 'match_invitation_create' ||
      operation === 'match_invitation_accept' ||
      operation === 'match_invitation_decline' ||
      operation === 'match_invitation_cancel';
    const requestKey =
      requiresRequestKey ? createRequestKey(cryptoImpl) : null;
    if (requiresRequestKey && !requestKey) {
      return frozen('rejected', { reason: 'internal_error' });
    }

    for (let requestNumber = 0; requestNumber < MAX_REQUESTS; requestNumber += 1) {
      const attempt = await requestOnce(
        operation,
        credential,
        requestKey,
        externalSignal,
        operationPayload,
      );
      if (attempt.outcome === 'success') return attempt.result;
      if (attempt.outcome === 'cancelled') return frozen('cancelled');
      if (attempt.outcome === 'configuration_failure') {
        return frozen('rejected', { reason: 'internal_error' });
      }
      if (
        attempt.outcome === 'network_failure' ||
        attempt.outcome === 'request_timeout' ||
        attempt.outcome === 'retryable_unavailable'
      ) {
        if (requestNumber === MAX_REQUESTS - 1) {
          return frozen('rejected', { reason: 'temporary_unavailable' });
        }
        let completed;
        try {
          completed = await sleep(
            retryDelayMs(requestNumber, random),
            externalSignal,
          );
        } catch {
          return externalSignal?.aborted
            ? frozen('cancelled')
            : frozen('rejected', { reason: 'internal_error' });
        }
        if (completed === false || externalSignal?.aborted) {
          return externalSignal?.aborted
            ? frozen('cancelled')
            : frozen('rejected', { reason: 'internal_error' });
        }
        continue;
      }
      return frozen('rejected', { reason: 'internal_error' });
    }
    return frozen('rejected', { reason: 'internal_error' });
  }

  return Object.freeze({
    authenticate: (credential, options) =>
      execute('authenticate', credential, options),
    readOwnProfile: (credential, options) =>
      execute('profile', credential, options),
    updateOwnProfile: (credential, profilePatch, options) =>
      execute('profile_update', credential, options, profilePatch),
    listMatches: (credential, limit = 20, options) =>
      execute('match_list', credential, options, { limit }),
    readMatch: (credential, matchId, options) =>
      execute('match_detail', credential, options, { matchId }),
    createMatch: (credential, matchDraft, options) =>
      execute('match_create', credential, options, matchDraft),
    joinMatch: (credential, matchId, options) =>
      execute('match_join', credential, options, { matchId }),
    leaveMatch: (credential, matchId, options) =>
      execute('match_leave', credential, options, { matchId }),
    searchPlayers: (credential, query, limit = 8, options) =>
      execute('player_search', credential, options, { query, limit }),
    listIncomingMatchInvitations: (credential, limit = 20, options) =>
      execute('match_invitation_incoming', credential, options, { limit }),
    listOutgoingMatchInvitations: (
      credential,
      matchId,
      limit = 20,
      options,
    ) => execute(
      'match_invitation_outgoing',
      credential,
      options,
      { matchId, limit },
    ),
    createMatchInvitation: (
      credential,
      matchId,
      playerId,
      slotNumber,
      options,
    ) => execute(
      'match_invitation_create',
      credential,
      options,
      { matchId, playerId, slotNumber },
    ),
    acceptMatchInvitation: (credential, invitationId, options) =>
      execute(
        'match_invitation_accept',
        credential,
        options,
        { invitationId },
      ),
    declineMatchInvitation: (credential, invitationId, options) =>
      execute(
        'match_invitation_decline',
        credential,
        options,
        { invitationId },
      ),
    cancelMatchInvitation: (credential, invitationId, options) =>
      execute(
        'match_invitation_cancel',
        credential,
        options,
        { invitationId },
      ),
    refresh: (credential, options) =>
      execute('refresh', credential, options),
    logout: (credential, options) =>
      execute('logout', credential, options),
  });
}

export const backendSessionClient = createBackendSessionClient();

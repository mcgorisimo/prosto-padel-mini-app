export const MATCH_RATING_FORMULA_VERSION = 'doubles_elo_v1' as const;

export type MatchRatingTeamNumber = 1 | 2;
export type MatchRatingCourtSide = 'left' | 'right';

export interface MatchRatingParticipantInput {
  readonly teamNumber: MatchRatingTeamNumber;
  readonly courtSide: MatchRatingCourtSide;
  readonly ratingBeforeCents: number;
  readonly ratedMatchesBefore: number;
}

export interface MatchRatingParticipantChange
  extends MatchRatingParticipantInput {
  readonly ratingDeltaCents: number;
  readonly ratingAfterCents: number;
  readonly roundedDeltaMillis: number;
  readonly kFactor: 0.4 | 0.1;
  readonly expectedScore: number;
}

export interface MatchRatingCalculation {
  readonly formulaVersion: typeof MATCH_RATING_FORMULA_VERSION;
  readonly team1AverageBeforeMillis: number;
  readonly team2AverageBeforeMillis: number;
  readonly expectedTeam1: number;
  readonly changes: readonly MatchRatingParticipantChange[];
}

const MIN_RATING_CENTS = 0;
const MAX_RATING_CENTS = 1_000;
const MAX_RATING_MILLIS = MAX_RATING_CENTS * 10;

function validParticipant(value: MatchRatingParticipantInput): boolean {
  return (
    (value.teamNumber === 1 || value.teamNumber === 2) &&
    (value.courtSide === 'left' || value.courtSide === 'right') &&
    Number.isInteger(value.ratingBeforeCents) &&
    value.ratingBeforeCents >= MIN_RATING_CENTS &&
    value.ratingBeforeCents <= MAX_RATING_CENTS &&
    Number.isSafeInteger(value.ratedMatchesBefore) &&
    value.ratedMatchesBefore >= 0
  );
}

function ratingAfterCents(
  ratingBeforeCents: number,
  roundedDeltaMillis: number,
): number {
  const clampedMillis = Math.max(
    0,
    Math.min(
      MAX_RATING_MILLIS,
      ratingBeforeCents * 10 + roundedDeltaMillis,
    ),
  );

  // PostgreSQL numeric(4,2) rounds a non-negative half value away from zero.
  return Math.floor((clampedMillis + 5) / 10);
}

export function calculateDoublesEloV1(input: {
  readonly winningTeam: MatchRatingTeamNumber;
  readonly participants: readonly MatchRatingParticipantInput[];
}): MatchRatingCalculation {
  if (
    (input.winningTeam !== 1 && input.winningTeam !== 2) ||
    input.participants.length !== 4 ||
    !input.participants.every(validParticipant)
  ) {
    throw new TypeError('Invalid doubles rating input');
  }

  const slots = new Set(
    input.participants.map(
      ({ teamNumber, courtSide }) => `${teamNumber}:${courtSide}`,
    ),
  );
  if (
    slots.size !== 4 ||
    !['1:left', '1:right', '2:left', '2:right'].every((slot) =>
      slots.has(slot),
    )
  ) {
    throw new TypeError('Doubles rating requires four canonical slots');
  }

  const team1 = input.participants.filter(({ teamNumber }) => teamNumber === 1);
  const team2 = input.participants.filter(({ teamNumber }) => teamNumber === 2);
  const team1AverageBeforeMillis =
    (team1[0].ratingBeforeCents + team1[1].ratingBeforeCents) * 5;
  const team2AverageBeforeMillis =
    (team2[0].ratingBeforeCents + team2[1].ratingBeforeCents) * 5;
  const expectedTeam1 =
    1 /
    (1 +
      10 **
        ((team2AverageBeforeMillis - team1AverageBeforeMillis) / 4_000));
  const actualTeam1 = input.winningTeam === 1 ? 1 : 0;
  const team1Error = actualTeam1 - expectedTeam1;

  const changes = input.participants.map((participant) => {
    const kFactor = participant.ratedMatchesBefore < 10 ? 0.4 : 0.1;
    const team1RawDelta = kFactor * team1Error;
    const rawDelta =
      participant.teamNumber === 1 ? team1RawDelta : -team1RawDelta;
    const rounded = Math.round(rawDelta * 1_000);
    const roundedDeltaMillis = Object.is(rounded, -0) ? 0 : rounded;
    const afterCents = ratingAfterCents(
      participant.ratingBeforeCents,
      roundedDeltaMillis,
    );

    return Object.freeze({
      ...participant,
      ratingDeltaCents: afterCents - participant.ratingBeforeCents,
      ratingAfterCents: afterCents,
      roundedDeltaMillis,
      kFactor,
      expectedScore:
        participant.teamNumber === 1 ? expectedTeam1 : 1 - expectedTeam1,
    });
  });

  return Object.freeze({
    formulaVersion: MATCH_RATING_FORMULA_VERSION,
    team1AverageBeforeMillis,
    team2AverageBeforeMillis,
    expectedTeam1,
    changes: Object.freeze(changes),
  });
}

export function formatRatingCents(value: number): string {
  if (
    !Number.isInteger(value) ||
    value < MIN_RATING_CENTS ||
    value > MAX_RATING_CENTS
  ) {
    throw new TypeError('Invalid persisted rating cents');
  }
  return (value / 100).toFixed(2);
}

export function formatRatingDeltaCents(value: number): string {
  if (
    !Number.isInteger(value) ||
    value < -MAX_RATING_CENTS ||
    value > MAX_RATING_CENTS
  ) {
    throw new TypeError('Invalid persisted rating delta');
  }
  return (value / 100).toFixed(2);
}

export function formatRatingAverageMillis(value: number): string {
  if (
    !Number.isInteger(value) ||
    value < MIN_RATING_CENTS * 10 ||
    value > MAX_RATING_MILLIS
  ) {
    throw new TypeError('Invalid persisted rating average');
  }
  return (value / 1_000).toFixed(3);
}

export function formatExpectedScore(value: number): string {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new TypeError('Invalid expected score');
  }
  return value.toFixed(6);
}

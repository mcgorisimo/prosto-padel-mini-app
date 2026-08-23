export const PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION =
  'initial_level_v2';

export const PLAYER_ONBOARDING_INITIAL_LEVEL_QUESTION_CODES = Object.freeze([
  'match_count',
  'rally_stability',
  'glass_play',
  'serve_return_net',
  'match_experience_year',
] as const);

type PlayerOnboardingInitialLevelQuestion =
  (typeof PLAYER_ONBOARDING_INITIAL_LEVEL_QUESTION_CODES)[number];

export type PlayerOnboardingInitialLevelLabel =
  'D' | 'D+' | 'C' | 'C+' | 'B' | 'B+' | 'A';

export type PlayerOnboardingInitialLevelResult = Readonly<{
  score: number;
  label: PlayerOnboardingInitialLevelLabel;
}>;

const LEVELS = Object.freeze(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'] as const);

const OPTION_SCORES: Readonly<
  Record<PlayerOnboardingInitialLevelQuestion, Readonly<Record<string, number>>>
> = Object.freeze({
  match_count: Object.freeze({
    none: 0,
    one_to_ten: 1,
    eleven_to_thirty: 2,
    thirty_one_to_ninety_nine: 3,
    one_hundred_plus: 4,
  }),
  rally_stability: Object.freeze({
    learning_contact: 0,
    short_rallies: 1,
    steady_slow: 2,
    steady_under_pressure: 3,
    controls_pace: 4,
  }),
  glass_play: Object.freeze({
    not_used: 0,
    rarely_returns: 1,
    basic_returns: 2,
    confident_returns: 3,
    uses_tactically: 4,
  }),
  serve_return_net: Object.freeze({
    learning_basics: 0,
    inconsistent: 1,
    stable_basics: 2,
    confident_patterns: 3,
    advanced_patterns: 4,
  }),
  match_experience_year: Object.freeze({
    none: 0,
    casual_few: 1,
    regular_social: 2,
    league_or_club: 3,
    tournament: 4,
  }),
});

const TECHNICAL_QUESTIONS = Object.freeze([
  'rally_stability',
  'glass_play',
  'serve_return_net',
] as const);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function optionScore(
  question: PlayerOnboardingInitialLevelQuestion,
  answer: unknown,
): number | undefined {
  if (
    typeof answer !== 'string' ||
    !Object.prototype.hasOwnProperty.call(OPTION_SCORES[question], answer)
  ) {
    return undefined;
  }
  const score = OPTION_SCORES[question][answer];
  return Number.isInteger(score) && score >= 0 && score <= 4
    ? score
    : undefined;
}

export function playerOnboardingInitialLevelLabelForScore(
  score: number,
): PlayerOnboardingInitialLevelLabel | undefined {
  if (!Number.isSafeInteger(score) || score < 0 || score > 20) {
    return undefined;
  }
  if (score <= 2) return 'D';
  if (score <= 5) return 'D+';
  if (score <= 8) return 'C';
  if (score <= 11) return 'C+';
  if (score <= 14) return 'B';
  if (score <= 17) return 'B+';
  return 'A';
}

export function scorePlayerOnboardingInitialLevel(
  answers: Readonly<Record<string, string>>,
): PlayerOnboardingInitialLevelResult | undefined {
  if (
    !isPlainRecord(answers) ||
    Object.keys(answers).length !==
      PLAYER_ONBOARDING_INITIAL_LEVEL_QUESTION_CODES.length ||
    !PLAYER_ONBOARDING_INITIAL_LEVEL_QUESTION_CODES.every((question) =>
      Object.prototype.hasOwnProperty.call(answers, question),
    )
  ) {
    return undefined;
  }

  const scores = {} as Record<PlayerOnboardingInitialLevelQuestion, number>;
  for (const question of PLAYER_ONBOARDING_INITIAL_LEVEL_QUESTION_CODES) {
    const score = optionScore(question, answers[question]);
    if (score === undefined) return undefined;
    scores[question] = score;
  }

  const score = PLAYER_ONBOARDING_INITIAL_LEVEL_QUESTION_CODES.reduce(
    (sum, question) => sum + scores[question],
    0,
  );
  const bucket = playerOnboardingInitialLevelLabelForScore(score);
  if (bucket === undefined) return undefined;

  let maximumLevelIndex = LEVELS.length - 1;
  if (scores.match_count === 0) {
    maximumLevelIndex = Math.min(maximumLevelIndex, LEVELS.indexOf('D+'));
  } else if (scores.match_count === 1) {
    maximumLevelIndex = Math.min(maximumLevelIndex, LEVELS.indexOf('C'));
  }
  if (scores.glass_play <= 1) {
    maximumLevelIndex = Math.min(maximumLevelIndex, LEVELS.indexOf('C+'));
  }

  const qualifiesForBPlus =
    scores.match_count >= 3 &&
    TECHNICAL_QUESTIONS.every((question) => scores[question] >= 3);
  if (!qualifiesForBPlus) {
    maximumLevelIndex = Math.min(maximumLevelIndex, LEVELS.indexOf('B'));
  }

  const qualifiesForA =
    scores.match_count === 4 &&
    TECHNICAL_QUESTIONS.every((question) => scores[question] === 4) &&
    scores.match_experience_year === 4;
  if (!qualifiesForA) {
    maximumLevelIndex = Math.min(maximumLevelIndex, LEVELS.indexOf('B+'));
  }

  const label = LEVELS[Math.min(LEVELS.indexOf(bucket), maximumLevelIndex)];
  return Object.freeze({ score, label });
}

import {
  PLAYER_ONBOARDING_INITIAL_LEVEL_QUESTION_CODES,
  playerOnboardingInitialLevelLabelForScore,
  scorePlayerOnboardingInitialLevel,
} from './player-onboarding-initial-level';

const ANSWERS = Object.freeze({
  match_count: 'one_hundred_plus',
  rally_stability: 'controls_pace',
  glass_play: 'uses_tactically',
  serve_return_net: 'advanced_patterns',
  match_experience_year: 'tournament',
});

describe('player onboarding initial level v2', () => {
  it.each([
    [0, 'D'],
    [2, 'D'],
    [3, 'D+'],
    [5, 'D+'],
    [6, 'C'],
    [8, 'C'],
    [9, 'C+'],
    [11, 'C+'],
    [12, 'B'],
    [14, 'B'],
    [15, 'B+'],
    [17, 'B+'],
    [18, 'A'],
    [20, 'A'],
  ] as const)(
    'maps internal score %d to canonical bucket %s',
    (score, label) => {
      expect(playerOnboardingInitialLevelLabelForScore(score)).toBe(label);
    },
  );

  it.each([-1, 21, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid internal score %p',
    (score) => {
      expect(playerOnboardingInitialLevelLabelForScore(score)).toBeUndefined();
    },
  );

  it('computes the five-answer maximum deterministically', () => {
    const first = scorePlayerOnboardingInitialLevel(ANSWERS);
    const second = scorePlayerOnboardingInitialLevel({ ...ANSWERS });
    expect(first).toEqual({ score: 20, label: 'A' });
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(PLAYER_ONBOARDING_INITIAL_LEVEL_QUESTION_CODES).toEqual([
      'match_count',
      'rally_stability',
      'glass_play',
      'serve_return_net',
      'match_experience_year',
    ]);
  });

  it.each([
    [
      'zero matches',
      { ...ANSWERS, match_count: 'none' },
      { score: 16, label: 'D+' },
    ],
    [
      'up to ten matches',
      { ...ANSWERS, match_count: 'one_to_ten' },
      { score: 17, label: 'C' },
    ],
    [
      'weak glass play',
      { ...ANSWERS, glass_play: 'rarely_returns' },
      { score: 17, label: 'C+' },
    ],
    [
      'insufficient technical answers for B+',
      { ...ANSWERS, rally_stability: 'steady_slow' },
      { score: 18, label: 'B' },
    ],
    [
      'non-maximum technical answer for A',
      { ...ANSWERS, glass_play: 'confident_returns' },
      { score: 19, label: 'B+' },
    ],
    [
      'no tournament experience for A',
      { ...ANSWERS, match_experience_year: 'league_or_club' },
      { score: 19, label: 'B+' },
    ],
  ] as const)('applies the %s cap', (_label, answers, expected) => {
    expect(scorePlayerOnboardingInitialLevel(answers)).toEqual(expected);
  });

  it('allows B+ only with at least 31 matches and all technical answers at least 3', () => {
    expect(
      scorePlayerOnboardingInitialLevel({
        match_count: 'thirty_one_to_ninety_nine',
        rally_stability: 'steady_under_pressure',
        glass_play: 'confident_returns',
        serve_return_net: 'confident_patterns',
        match_experience_year: 'league_or_club',
      }),
    ).toEqual({ score: 15, label: 'B+' });
  });

  it.each([
    ['missing answer', { ...ANSWERS, glass_play: undefined }],
    ['unknown answer', { ...ANSWERS, glass_play: 'private_score_4' }],
    ['extra client score', { ...ANSWERS, score: '20' }],
    ['legacy one-question contract', { experience: 'advanced' }],
  ])('rejects %s without deriving a result', (_label, answers) => {
    expect(
      scorePlayerOnboardingInitialLevel(
        answers as unknown as Readonly<Record<string, string>>,
      ),
    ).toBeUndefined();
  });
});

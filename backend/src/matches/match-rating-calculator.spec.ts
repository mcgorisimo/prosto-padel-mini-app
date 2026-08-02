import {
  calculateDoublesEloV1,
  formatExpectedScore,
  formatRatingAverageMillis,
  formatRatingCents,
  formatRatingDeltaCents,
} from './match-rating-calculator';

function participant(
  teamNumber: 1 | 2,
  courtSide: 'left' | 'right',
  ratingBeforeCents: number,
  ratedMatchesBefore = 0,
) {
  return { teamNumber, courtSide, ratingBeforeCents, ratedMatchesBefore };
}

describe('doubles_elo_v1 calculator', () => {
  it('preserves legacy round3-before-numeric2 ordering at the observable boundary', () => {
    const calculated = calculateDoublesEloV1({
      winningTeam: 2,
      participants: [
        participant(1, 'left', 250),
        participant(1, 'right', 250),
        participant(2, 'left', 250),
        participant(2, 'right', 266),
      ],
    });

    expect(calculated.team1AverageBeforeMillis).toBe(2_500);
    expect(calculated.team2AverageBeforeMillis).toBe(2_580);
    expect(calculated.changes[0]).toMatchObject({
      roundedDeltaMillis: -195,
      ratingBeforeCents: 250,
      ratingAfterCents: 231,
      ratingDeltaCents: -19,
      kFactor: 0.4,
    });
    expect(formatRatingCents(calculated.changes[0].ratingAfterCents)).toBe(
      '2.31',
    );
    expect(formatRatingDeltaCents(calculated.changes[0].ratingDeltaCents)).toBe(
      '-0.19',
    );
    expect(formatRatingAverageMillis(calculated.team2AverageBeforeMillis)).toBe(
      '2.580',
    );
  });

  it('selects K per player and negates the team-1 delta for team 2', () => {
    const calculated = calculateDoublesEloV1({
      winningTeam: 1,
      participants: [
        participant(1, 'left', 500, 9),
        participant(1, 'right', 500, 10),
        participant(2, 'left', 500, 9),
        participant(2, 'right', 500, 10),
      ],
    });

    expect(calculated.changes.map((change) => change.kFactor)).toEqual([
      0.4,
      0.1,
      0.4,
      0.1,
    ]);
    expect(calculated.changes[0].roundedDeltaMillis).toBe(
      -calculated.changes[2].roundedDeltaMillis,
    );
    expect(calculated.changes[1].roundedDeltaMillis).toBe(
      -calculated.changes[3].roundedDeltaMillis,
    );
  });

  it('clamps persisted ratings to the backend range', () => {
    const calculated = calculateDoublesEloV1({
      winningTeam: 1,
      participants: [
        participant(1, 'left', 1_000),
        participant(1, 'right', 1_000),
        participant(2, 'left', 0),
        participant(2, 'right', 0),
      ],
    });

    expect(calculated.changes.map((change) => change.ratingAfterCents)).toEqual([
      1_000,
      1_000,
      0,
      0,
    ]);
  });

  it('formats the six-decimal expected scores stored by migration 026', () => {
    const calculated = calculateDoublesEloV1({
      winningTeam: 1,
      participants: [
        participant(1, 'left', 300),
        participant(1, 'right', 300),
        participant(2, 'left', 300),
        participant(2, 'right', 300),
      ],
    });

    expect(formatExpectedScore(calculated.expectedTeam1)).toBe('0.500000');
    expect(formatExpectedScore(1 - calculated.expectedTeam1)).toBe('0.500000');
    expect(calculated.changes.map((change) => change.ratingDeltaCents)).toEqual([
      20,
      20,
      -20,
      -20,
    ]);
  });

  it('rejects incomplete, duplicated or noncanonical input', () => {
    expect(() =>
      calculateDoublesEloV1({
        winningTeam: 1,
        participants: [
          participant(1, 'left', 300),
          participant(1, 'right', 300),
          participant(2, 'left', 300),
        ],
      }),
    ).toThrow(TypeError);
    expect(() =>
      calculateDoublesEloV1({
        winningTeam: 1,
        participants: [
          participant(1, 'left', 300),
          participant(1, 'right', 300),
          participant(2, 'left', 300),
          participant(2, 'left', 300),
        ],
      }),
    ).toThrow(TypeError);
    expect(() => formatRatingCents(1_001)).toThrow(TypeError);
  });
});

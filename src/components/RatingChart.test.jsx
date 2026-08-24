// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RatingChart from './RatingChart';

describe('RatingChart', () => {
  it('does not present the unverified 3.00 default as a current club rating', () => {
    render(
      <RatingChart
        currentRating={3}
        isClubRatingPending
        userId="synthetic-player"
      />,
    );

    expect(screen.getByTestId('profile-club-rating-pending').textContent).toBe(
      'Клубный рейтинг пока не сформирован',
    );
    expect(document.body.textContent).not.toContain('3.00');
    expect(document.body.textContent).not.toContain('· C');
  });

  it('preserves the numeric fallback for verified and legacy callers', () => {
    render(<RatingChart currentRating={4.2} userId="synthetic-player" />);

    expect(screen.getByTestId('profile-club-rating-current').textContent).toBe(
      'Текущий клубный рейтинг: 4.20 · B',
    );
  });

  it('keeps trusted rating history visible even when the initial level exists', () => {
    render(
      <RatingChart
        currentRating={2.5}
        completedMatches={[
          {
            id: 'synthetic-match',
            completedAt: '2026-08-24T12:00:00Z',
            isRatingMatch: true,
            ratingChanges: {
              'synthetic-player': { after: 2.5, delta: 0.1 },
            },
          },
        ]}
        isClubRatingPending
        userId="synthetic-player"
      />,
    );

    expect(screen.queryByTestId('profile-club-rating-pending')).toBeNull();
    expect(document.body.textContent).toContain('2.50');
    expect(document.body.textContent).toContain('D+');
  });
});

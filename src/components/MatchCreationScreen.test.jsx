// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MatchCreationScreen, {
  createMatchBookingMetadata,
} from './MatchCreationScreen';

const bookingProps = vi.hoisted(() => ({ current: null }));

vi.mock('./BookingScreen', () => ({
  default: (props) => {
    bookingProps.current = props;
    return <div data-testid="canonical-booking-screen">Каноническая бронь</div>;
  },
}));

describe('MatchCreationScreen canonical booking handoff', () => {
  beforeEach(() => {
    bookingProps.current = null;
  });

  it.each(['community', 'social'])('routes %s through the same BookingScreen', (scenario) => {
    render(
      <MatchCreationScreen
        user={{ isVerified: true }}
        availabilityActions={{}}
        bookingClient={{ fullName: 'Игрок', phone: '79990000000' }}
        allowPrivateMatches
      />,
    );

    fireEvent.click(screen.getByTestId(`match-scenario-${scenario}`));
    const continueButton = screen.getByTestId('match-continue-to-booking');
    expect(continueButton.closest('.match-creation-continue-bar')).toBeTruthy();
    fireEvent.click(continueButton);

    expect(screen.getByTestId('canonical-booking-screen')).toBeTruthy();
    expect(bookingProps.current).toMatchObject({
      reservationPurpose: 'match',
      availabilityActions: {},
    });
  });

  it('keeps open rating metadata and the existing private rating boundary', () => {
    expect(createMatchBookingMetadata({
      scenario: 'social',
      ratingMin: 2,
      ratingMax: 5,
      description: 'Игра',
      isPrivate: false,
      isRatingMatch: true,
      allowPrivateMatches: true,
    })).toEqual({
      scenario: 'social',
      isPrivate: false,
      isRatingMatch: true,
      description: 'Игра',
      ratingMin: 2,
      ratingMax: 5,
    });
    expect(createMatchBookingMetadata({
      scenario: 'community',
      ratingMin: 2,
      ratingMax: 5,
      description: '',
      isPrivate: true,
      isRatingMatch: true,
      allowPrivateMatches: true,
    })).toEqual({
      scenario: 'private',
      isPrivate: true,
      isRatingMatch: false,
      description: '',
    });
  });
});

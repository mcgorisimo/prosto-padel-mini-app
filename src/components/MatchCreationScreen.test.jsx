// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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


describe('existing reservation publication', () => {
  const reservation = { reservationId: '11111111-1111-4111-8111-111111111111', status: 'confirmed', stale: false, courtId: 22, startsAt: '2099-09-06T12:00:00+03:00', endsAt: '2099-09-06T13:30:00+03:00' };
  it.each(['community', 'social'])('publishes %s only explicitly and suppresses double click without booking', async (scenario) => {
    let finish;
    const onSuccess = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    render(<MatchCreationScreen existingReservation={reservation} courtNamesById={{22: 'Корт 22'}} onSuccess={onSuccess} user={{isVerified:true}} />);
    fireEvent.click(screen.getByTestId(`match-scenario-${scenario}`));
    expect(screen.getByTestId('match-existing-reservation').textContent).toContain('Корт 22');
    expect(screen.queryByTestId('canonical-booking-screen')).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: 'Опубликовать матч' });
    fireEvent.click(button); fireEvent.click(button);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][0]).toMatchObject({ scenario, reservationId: reservation.reservationId });
    expect(onSuccess.mock.calls[0][0]).not.toHaveProperty('courtId');
    finish({outcome: 'match_created'});
    await waitFor(() => expect(button.disabled).toBe(false));
  });
  it('keeps metadata and reservation on a failed response for safe retry', async () => {
    const onSuccess = vi.fn().mockRejectedValueOnce(new Error('lost')).mockResolvedValue({outcome:'match_created'});
    render(<MatchCreationScreen existingReservation={reservation} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByTestId('match-scenario-social'));
    fireEvent.click(screen.getByRole('button', {name:'Опубликовать матч'}));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', {name:'Опубликовать матч'}));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(2));
    expect(onSuccess.mock.calls[0]).toEqual(onSuccess.mock.calls[1]);
  });
});

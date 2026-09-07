// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from './Home';

afterEach(cleanup);
const booking = { id: 'reservation:first', reservationId: 'first', type: 'private', isBackendReservation: true,
  reservationStatus: 'confirmed', time: '09:00', dateISO: '2035-10-05', courtName: 'Первый корт' };
const match = { id: 'match:second', type: 'match', time: '10:00', dateISO: '2035-10-05', courtName: 'Второй корт' };

describe('Home event priority', () => {
  it('shows the nearest event once, keeps filters and navigation, without the removed hero sections', () => {
    const onOpenBooking = vi.fn();
    const onOpenMemberships = vi.fn();
    const onViewDetails = vi.fn();
    const onOpenTrainings = vi.fn();
    const { container } = render(<Home upcomingMatches={[match, booking]} onOpenBooking={onOpenBooking} onOpenMemberships={onOpenMemberships} onViewDetails={onViewDetails} onOpenTrainings={onOpenTrainings} user={{ firstName: 'Игрок', numericRating: 5 }} />);
    expect(screen.getAllByText('Первый корт')).toHaveLength(1);
    expect([...container.querySelectorAll('.home-event-card')].map((card) => card.textContent)).toEqual([
      expect.stringContaining('Первый корт'), expect.stringContaining('Второй корт'),
    ]);
    expect(container.querySelector('[data-testid="home-player-level-value"]')).toBeNull();
    expect(screen.queryByText('Ближайшее событие')).toBeNull();
    expect(screen.queryByText('Смотреть все события')).toBeNull();
    expect(container.textContent).not.toContain('Пятницкое');
    const eventsHeading = screen.getByRole('heading', { name: 'Мои события' });
    const group = screen.getByRole('button', { name: 'Групповые тренировки', exact: true });
    expect(eventsHeading.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Брони 1/ }));
    fireEvent.click(screen.getByText('Первый корт'));
    expect(onOpenBooking).toHaveBeenCalledWith('first');
    expect(screen.queryByText('Второй корт')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Матчи 1/ }));
    fireEvent.click(screen.getByText('Второй корт'));
    expect(onViewDetails).toHaveBeenCalledWith(match);
    fireEvent.click(screen.getByRole('button', { name: /Тренировки 0/ }));
    expect(onOpenTrainings).not.toHaveBeenCalled();
    fireEvent.click(group);
    expect(onOpenTrainings).toHaveBeenCalledTimes(1);
    const memberships = screen.getByRole('button', { name: 'Абонементы', exact: true });
    expect(group.querySelector('svg')).toBeNull();
    expect(memberships.querySelector('svg')).toBeNull();
    fireEvent.click(memberships);
    expect(onOpenMemberships).toHaveBeenCalledTimes(1);
  });

  it('keeps a working choose-time action for empty all/bookings, but does not pretend to offer training signup', () => {
    const onBookCourt = vi.fn();
    render(<Home onBookCourt={onBookCourt} />);
    expect(screen.getByText('У вас пока нет событий.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать время' }));
    fireEvent.click(screen.getByRole('button', { name: /Брони 0/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать время' }));
    expect(onBookCourt).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: /Тренировки 0/ }));
    expect(screen.queryByRole('button', { name: 'Выбрать время' })).toBeNull();
  });
});

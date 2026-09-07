// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from '../Home';
import BottomNav from '../BottomNav';
import { CrossedPadelRacketsIcon, PadelBookingIcon, PadelTrainingIcon } from './PadelIcons';

afterEach(cleanup);

describe('padel sport icons', () => {
  it('renders one racket and a separate tennis ball with two curved seams, without a target', () => {
    const { container } = render(<PadelTrainingIcon />);
    expect(container.querySelectorAll('[data-padel-part="racket"]')).toHaveLength(1);
    const ball = container.querySelector('[data-padel-part="ball"]');
    expect(ball.querySelectorAll('circle')).toHaveLength(1);
    expect(ball.querySelector('circle').getAttribute('r')).toBe('4.2');
    expect(ball.querySelectorAll('path')).toHaveLength(2);
    for (const seam of ball.querySelectorAll('path')) expect(seam.getAttribute('d')).toMatch(/c/);
  });

  it('renders two crossed padel rackets and a separate seamed ball for matches', () => {
    const { container } = render(<CrossedPadelRacketsIcon />);
    expect(container.querySelectorAll('[data-padel-part="racket"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-padel-part="head"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-padel-part="head-outline"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-padel-part="grip"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-padel-part="racket"] circle')).toHaveLength(20);
    const ball = container.querySelector('[data-padel-part="ball"]');
    expect(ball.querySelectorAll('circle')).toHaveLength(1);
    expect(ball.querySelectorAll('path')).toHaveLength(2);
  });

  it('renders a white calendar with a lime ball and white seams for bookings', () => {
    const { container } = render(<PadelBookingIcon />);
    const calendar = container.querySelector('[data-padel-part="calendar"]');
    const ball = container.querySelector('[data-padel-part="ball"]');
    expect(calendar.getAttribute('stroke')).toBe('#F5F1E8');
    expect(ball.querySelector('circle').getAttribute('fill')).toBe('#78B83F');
    expect(ball.querySelector('circle').getAttribute('stroke')).toBe('#78B83F');
    expect(ball.querySelector('g').getAttribute('stroke')).toBe('#F5F1E8');
    expect(ball.querySelectorAll('path')).toHaveLength(2);
  });

  it.each([PadelTrainingIcon, CrossedPadelRacketsIcon, PadelBookingIcon])('accepts existing Lucide sizing props', (Icon) => {
    const { container } = render(<Icon size={21} strokeWidth={2.4} className="text-accent-light" />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('width')).toBe('21');
    expect(svg.getAttribute('height')).toBe('21');
    expect(svg.getAttribute('stroke-width')).toBe('2.4');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg.getAttribute('class')).toBe('text-accent-light');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(container.querySelector('image')).toBeNull();
  });

  it('keeps filter and badge icons while Home feature CTAs stay text-only', () => {
    const onOpenTrainings = vi.fn();
    const onOpenMemberships = vi.fn();
    const { container } = render(<Home onOpenTrainings={onOpenTrainings} onOpenMemberships={onOpenMemberships} upcomingMatches={[
      { id: 'match', type: 'match', dateISO: '2035-10-05', time: '09:00' },
      { id: 'booking', type: 'private', dateISO: '2035-10-05', time: '09:30' },
      { id: 'training', type: 'private', isTraining: true, dateISO: '2035-10-05', time: '10:00' },
    ]} />);
    expect(screen.getByRole('button', { name: 'Брони 1' }).querySelector('[data-padel-icon="bookings"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Матчи 1' }).querySelector('[data-padel-icon="matches"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Тренировки 1' }).querySelector('[data-padel-icon="trainings"]')).not.toBeNull();
    expect(container.querySelectorAll('.home-event-kind-badge [data-padel-icon="bookings"]')).toHaveLength(1);
    expect(container.querySelectorAll('.home-event-kind-badge [data-padel-icon="matches"]')).toHaveLength(1);
    expect(container.querySelectorAll('.home-event-kind-badge [data-padel-icon="trainings"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-padel-icon="trainings"]')).toHaveLength(2);
    const eventsHeading = screen.getByRole('heading', { name: 'Мои события' });
    expect(eventsHeading.parentElement.parentElement.querySelector('svg')).toBeNull();
    const group = screen.getByRole('button', { name: 'Групповые тренировки' });
    const memberships = screen.getByRole('button', { name: 'Абонементы' });
    expect(group.querySelector('svg')).toBeNull();
    expect(memberships.querySelector('svg')).toBeNull();
    fireEvent.click(group);
    fireEvent.click(memberships);
    expect(onOpenTrainings).toHaveBeenCalledOnce();
    expect(onOpenMemberships).toHaveBeenCalledOnce();
  });

  it('keeps all five BottomNav labels, actions and active stroke widths', () => {
    const setActive = vi.fn();
    const { rerender } = render(<BottomNav active="home" setActive={setActive} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Главная', 'Матчи', 'Бронь', 'Рейтинг', 'Профиль']);
    const matches = screen.getByRole('button', { name: 'Матчи' });
    const booking = screen.getByRole('button', { name: 'Бронь' });
    expect(matches.querySelector('svg').getAttribute('data-padel-icon')).toBe('matches');
    expect(booking.querySelector('svg').getAttribute('data-padel-icon')).toBe('bookings');
    expect(matches.querySelector('svg').getAttribute('stroke-width')).toBe('1.9');
    fireEvent.click(matches);
    expect(setActive).toHaveBeenCalledWith('matches');
    rerender(<BottomNav active="matches" setActive={setActive} />);
    expect(matches.getAttribute('aria-current')).toBe('page');
    expect(matches.querySelector('svg').getAttribute('stroke-width')).toBe('2.4');
    fireEvent.click(booking);
    expect(setActive).toHaveBeenLastCalledWith('booking');
    rerender(<BottomNav active="booking" setActive={setActive} />);
    expect(booking.getAttribute('aria-current')).toBe('page');
    expect(booking.querySelector('svg').getAttribute('stroke-width')).toBe('2.4');
  });

  it('removes the superseded structural icons from both affected components', () => {
    for (const name of ['Home.jsx', 'BottomNav.jsx']) {
      const source = readFileSync(resolve(process.cwd(), 'src/components', name), 'utf8');
      expect(source).not.toMatch(/\b(?:CalendarDays|CourtIcon|Dumbbell|Swords)\b/);
    }
  });
});

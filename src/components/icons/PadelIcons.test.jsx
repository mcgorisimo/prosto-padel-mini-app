// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from '../Home';
import BottomNav from '../BottomNav';
import { PadelTrainingIcon } from './PadelIcons';

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

  it.each([PadelTrainingIcon])('inherits color and accepts existing Lucide sizing props', (Icon) => {
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

  it('keeps filter, badge and CTA icons without a decorative events heading icon', () => {
    const onOpenTrainings = vi.fn();
    const { container } = render(<Home onOpenTrainings={onOpenTrainings} upcomingMatches={[
      { id: 'match', type: 'match', dateISO: '2035-10-05', time: '09:00' },
      { id: 'training', type: 'private', isTraining: true, dateISO: '2035-10-05', time: '10:00' },
    ]} />);
    expect(screen.getByRole('button', { name: 'Матчи 1' }).querySelector('.lucide-swords')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Тренировки 1' }).querySelector('[data-padel-icon="trainings"]')).not.toBeNull();
    expect(container.querySelectorAll('.home-event-kind-badge [data-padel-icon="trainings"]')).toHaveLength(1);
    expect(container.querySelectorAll('.home-event-kind-badge .lucide-swords')).toHaveLength(1);
    expect(container.querySelectorAll('.lucide-swords')).toHaveLength(2);
    expect(container.querySelectorAll('[data-padel-icon="trainings"]')).toHaveLength(3);
    const eventsHeading = screen.getByRole('heading', { name: 'Мои события' });
    expect(eventsHeading.parentElement.parentElement.querySelector('svg')).toBeNull();
    const group = screen.getByRole('button', { name: 'Групповые тренировки' });
    expect(group.querySelector('[data-padel-icon="trainings"]')).not.toBeNull();
    expect(group.querySelector('svg').getAttribute('width')).toBe('32');
    fireEvent.click(group);
    expect(onOpenTrainings).toHaveBeenCalledOnce();
  });

  it('keeps all five BottomNav labels, actions and active stroke widths', () => {
    const setActive = vi.fn();
    const { rerender } = render(<BottomNav active="home" setActive={setActive} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Главная', 'Матчи', 'Бронь', 'Рейтинг', 'Профиль']);
    const matches = screen.getByRole('button', { name: 'Матчи' });
    expect(matches.querySelector('.lucide-swords')).not.toBeNull();
    expect(matches.querySelector('svg').getAttribute('stroke-width')).toBe('1.9');
    fireEvent.click(matches);
    expect(setActive).toHaveBeenCalledWith('matches');
    rerender(<BottomNav active="matches" setActive={setActive} />);
    expect(matches.getAttribute('aria-current')).toBe('page');
    expect(matches.querySelector('svg').getAttribute('stroke-width')).toBe('2.4');
  });

  it('uses standard Swords for matches without the former dumbbell icon', () => {
    for (const name of ['Home.jsx', 'BottomNav.jsx']) {
      const source = readFileSync(resolve(process.cwd(), 'src/components', name), 'utf8');
      expect(source).not.toMatch(/\bDumbbell\b/);
    }
  });
});

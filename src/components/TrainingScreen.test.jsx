// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TrainingScreen from './TrainingScreen';

vi.mock('../hooks/useTelegram', () => ({ useTelegram: () => ({ tg: null }) }));
afterEach(cleanup);

const LOADED = Object.freeze({
  outcome: 'loaded',
  lastUpdatedAt: '2030-03-17T07:55:00.000Z',
  sessions: Object.freeze([{
    id: '11111111-1111-5111-8111-111111111111',
    title: 'Групповая тренировка Новички D/D+',
    startsAt: '2030-03-17T08:00:00.000Z',
    durationSeconds: 3_600,
    courtName: 'Корт №4',
    capacity: 4,
    occupied: 1,
    remaining: 3,
  }]),
});

describe('TrainingScreen fresh read-only schedule', () => {
  it('renders grouped Moscow time and proven capacity without a write action', async () => {
    const onBack = vi.fn();
    const readSchedule = vi.fn().mockResolvedValue(LOADED);
    render(<TrainingScreen readSchedule={readSchedule} onBack={onBack} />);

    expect(await screen.findByText('Новички D/D+')).toBeTruthy();
    expect(screen.queryByText('Групповая тренировка Новички D/D+')).toBeNull();
    expect(screen.getByText('11:00–12:00')).toBeTruthy();
    expect(screen.getByText('Корт №4')).toBeTruthy();
    expect(screen.getByText('Тренер уточняется')).toBeTruthy();
    expect(screen.getByText('Осталось 3 из 4')).toBeTruthy();
    expect(screen.getByText('Занято 1 из 4')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /запис/iu })).toBeNull();
    expect(document.body.textContent).not.toContain('2500');
    expect(document.body.textContent).not.toContain('11111111');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('clears a stale list, retries manually and refreshes on foreground', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const readSchedule = vi.fn()
      .mockResolvedValueOnce({ outcome: 'stale', sessions: [], lastUpdatedAt: '2030-03-17T07:50:00.000Z' })
      .mockResolvedValue(LOADED);
    const interval = vi.spyOn(window, 'setInterval');
    render(<TrainingScreen readSchedule={readSchedule} onBack={() => {}} />);

    expect(await screen.findByText('Расписание нужно обновить')).toBeTruthy();
    expect(screen.queryByText('Новички D/D+')).toBeNull();
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 5 * 60_000);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Новички D/D+')).toBeTruthy();
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(readSchedule).toHaveBeenCalledTimes(3));
  });
});

import { COURTS, WORKING_HOURS, BOOKING_DURATIONS } from './clubConfig';

export { COURTS, WORKING_HOURS, BOOKING_DURATIONS };

export const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return (h < WORKING_HOURS.startHour ? h + 24 : h) * 60 + m;
};

export const fromMin = (m) => {
  const hour = Math.floor(m / 60) % 24;
  return `${String(hour).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export const HOURS = (() => {
  const out = [];
  const start = WORKING_HOURS.startHour * 60;
  const minDuration = Math.min(...BOOKING_DURATIONS) * 60;
  const latestStart = WORKING_HOURS.endHour * 60 - minDuration;

  for (let min = start; min <= latestStart; min += WORKING_HOURS.slotStepMinutes) {
    out.push(fromMin(min));
  }

  return out;
})();

/**
 * Checks whether a (courtId x dateISO x startTime x duration) interval collides
 * with any existing non-completed match on that court/day.
 * Returns true if available, false if blocked.
 */
export function checkAvailability(allMatches, courtId, dateISO, startTime, duration) {
  const startMin = toMin(startTime);
  const endMin = startMin + duration * 60;
  if (endMin > WORKING_HOURS.endHour * 60) return false;

  for (const m of allMatches ?? []) {
    if (!m || m.status === 'completed') continue;
    if (m.courtId !== courtId || m.dateISO !== dateISO) continue;

    const mStart = toMin(m.time);
    const mEnd = mStart + (m.duration ?? 0) * 60;
    if (startMin < mEnd && endMin > mStart) return false;
  }

  return true;
}

export const generateDates = () => {
  const dates = [];
  const today = new Date();

  for (let i = 0; i < 14; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    dates.push({
      dateObj: date,
      dayOfWeek: date.toLocaleDateString('ru-RU', { weekday: 'short' }),
      dayOfMonth: date.getDate(),
      dateISO: date.toISOString().slice(0, 10),
    });
  }

  return dates;
};

// Shared constants and helpers for booking calendar and modals.

export const COURTS = [
  ...Array.from({ length: 8 }, (_, i) => ({ id: `p${i+1}`, name: `Корт ${i+1}`, type: 'panoramic' })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `s${i+1}`, name: `Сингл ${i+1}`, type: 'single'    })),
];

// 07:00 → 23:00 in 30-min steps. 33 rows.
export const HOURS = (() => {
  const out = [];
  for (let h = 7; h <= 23; h++) {
    out.push(`${String(h).padStart(2, '0')}:00`);
    if (h < 23) out.push(`${String(h).padStart(2, '0')}:30`);
  }
  return out;
})();

export const toMin   = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * Checks whether a (courtId × dateISO × startTime × duration) interval collides
 * with any existing non-completed match on that court/day.
 * Returns true if available, false if blocked.
 */
export function checkAvailability(allMatches, courtId, dateISO, startTime, duration) {
  const startMin = toMin(startTime);
  const endMin   = startMin + duration * 60;
  for (const m of allMatches ?? []) {
    if (!m || m.status === 'completed') continue;
    if (m.courtId !== courtId || m.dateISO !== dateISO) continue;
    const mStart = toMin(m.time);
    const mEnd   = mStart + (m.duration ?? 0) * 60;
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
      dateISO: date.toISOString().slice(0, 10), // For internal use
    });
  }
  return dates;
};
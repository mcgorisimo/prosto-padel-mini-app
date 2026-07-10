// Court pricing — shared between MatchDetailsScreen and BookingModal.
// Single source of truth for rates. Adjust here when the club changes prices.

export const RATES = Object.freeze({
  DAY:    5000,  // ₽/h, panoramic, before 17:00
  PRIME:  8000,  // ₽/h, panoramic, 17:00+
  SINGLE: 3000,  // ₽/h, single court, all day
});

const PRIME_START_MIN = 17 * 60;

export const fmtPrice = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

export const toMin = (time) => {
  const [h, m] = time.split(':').map(Number);
  return (h < 7 ? h + 24 : h) * 60 + m;
};

export const isPrimeTime = (time) => toMin(time) >= PRIME_START_MIN;

// Returns segments of price breakdown, e.g. day portion + prime portion if it crosses 17:00.
export function getPriceBreakdown(time, hours, courtType = 'panoramic') {
  if (courtType === 'single') {
    return [{ label: 'Сингл', rate: RATES.SINGLE, amount: RATES.SINGLE * hours }];
  }
  const start = toMin(time);
  const end   = start + hours * 60;
  if (end <= PRIME_START_MIN) return [{ label: 'Дневное ☀', rate: RATES.DAY,   amount: hours * RATES.DAY   }];
  if (start >= PRIME_START_MIN) return [{ label: 'Prime ✦',   rate: RATES.PRIME, amount: hours * RATES.PRIME }];
  const dayMin   = PRIME_START_MIN - start;
  const primeMin = end - PRIME_START_MIN;
  return [
    { label: 'Дневное ☀', rate: RATES.DAY,   amount: (dayMin / 60)   * RATES.DAY   },
    { label: 'Prime ✦',   rate: RATES.PRIME, amount: (primeMin / 60) * RATES.PRIME },
  ];
}

export const getTotalPrice = (time, hours, courtType = 'panoramic') =>
  Math.round(getPriceBreakdown(time, hours, courtType).reduce((s, l) => s + l.amount, 0));

// Per-player share for doubles (4 slots) or singles (2 slots).
export function getPerPlayerPrice(time, hours, courtType = 'panoramic') {
  if (courtType === 'single') return Math.round((RATES.SINGLE * hours) / 2);
  return Math.round(getTotalPrice(time, hours, courtType) / 4);
}

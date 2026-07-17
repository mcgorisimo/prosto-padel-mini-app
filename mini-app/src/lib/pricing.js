import { PRICING, WORKING_HOURS } from './clubConfig';
import { toMin } from './booking';

const WEEKDAY_DAY_RATE = PRICING.weekday[0].rate;
const WEEKDAY_PEAK_RATE = PRICING.weekday[1].rate;
const WEEKEND_PEAK_RATE = PRICING.weekend[1].rate;

export const RATES = Object.freeze({
  DAY: WEEKDAY_DAY_RATE,
  PRIME: WEEKDAY_PEAK_RATE,
  WEEKEND: WEEKEND_PEAK_RATE,
});

export const fmtPrice = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

export function normalizeStoredPrice(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

export function formatParticipationPrice(value, { isFree = false } = {}) {
  const price = normalizeStoredPrice(value);
  if (price !== null && price > 0) return fmtPrice(price);
  if (price === 0 && isFree) return 'Бесплатно';
  return 'Стоимость уточняется';
}

const getStoredParticipationPrice = (source) => {
  const candidates = [
    normalizeStoredPrice(source?.pricePerPerson),
    normalizeStoredPrice(source?.price_per_person),
  ];
  return candidates.find((price) => price !== null && price > 0)
    ?? (candidates.includes(0) ? 0 : null);
};

const hasValidFallbackParams = ({ dateISO, time, duration }) => {
  if (typeof dateISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return false;
  const [year, month, day] = dateISO.split('-').map(Number);
  const parsedDate = new Date(`${dateISO}T12:00:00`);
  if (
    Number.isNaN(parsedDate.getTime())
    || parsedDate.getFullYear() !== year
    || parsedDate.getMonth() + 1 !== month
    || parsedDate.getDate() !== day
  ) return false;
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
  if (!Number.isFinite(duration) || duration <= 0) return false;

  const start = toMin(time);
  return start >= WORKING_HOURS.startHour * 60
    && start + duration * 60 <= WORKING_HOURS.endHour * 60;
};

const isWeekend = (dateISO) => {
  if (!dateISO) return false;
  const day = new Date(`${dateISO}T12:00:00`).getDay();
  return day === 0 || day === 6;
};

const getSegmentsForDate = (dateISO) => (isWeekend(dateISO) ? PRICING.weekend : PRICING.weekday);

const getSegmentBounds = (segment) => ({
  start: toMin(segment.from),
  end: segment.to === '00:00' ? WORKING_HOURS.endHour * 60 : toMin(segment.to),
});

export const getRateForTime = (time, dateISO) => {
  const minute = toMin(time);
  const segment = getSegmentsForDate(dateISO).find((item) => {
    const { start, end } = getSegmentBounds(item);
    return minute >= start && minute < end;
  });

  return segment ?? getSegmentsForDate(dateISO)[0];
};

export const isPrimeTime = (time, dateISO) => {
  const segment = getRateForTime(time, dateISO);
  return segment.rate > WEEKDAY_DAY_RATE;
};

export function getPriceBreakdown(time, hours, courtType = 'panoramic', dateISO) {
  const start = toMin(time);
  const end = start + hours * 60;

  return getSegmentsForDate(dateISO)
    .map((segment) => {
      const bounds = getSegmentBounds(segment);
      const overlapStart = Math.max(start, bounds.start);
      const overlapEnd = Math.min(end, bounds.end);
      const minutes = Math.max(0, overlapEnd - overlapStart);

      if (!minutes) return null;

      const segmentHours = minutes / 60;
      return {
        label: segment.label,
        hours: segmentHours,
        rate: segment.rate,
        amount: segmentHours * segment.rate,
      };
    })
    .filter(Boolean);
}

export const getTotalPrice = (time, hours, courtType = 'panoramic', dateISO) =>
  Math.round(getPriceBreakdown(time, hours, courtType, dateISO).reduce((sum, line) => sum + line.amount, 0));

export const getCourtCapacity = () => 4;

export function getPerPlayerPrice(time, hours, courtType = 'panoramic', dateISO) {
  return Math.round(getTotalPrice(time, hours, courtType, dateISO) / getCourtCapacity(courtType));
}

export function getParticipationPrice(source, { allowFallback = false } = {}) {
  const storedPrice = getStoredParticipationPrice(source);
  const isExplicitlyFree = source?.isFree === true || source?.is_free === true;

  if (storedPrice !== null && storedPrice > 0) return storedPrice;
  if (storedPrice === 0 && isExplicitlyFree) return 0;
  if (!allowFallback) return null;

  const params = {
    dateISO: source?.dateISO ?? source?.date_iso,
    time: source?.time ?? source?.start_time,
    duration: Number(source?.duration),
    courtType: source?.courtType ?? source?.court_type ?? 'panoramic',
  };
  if (!hasValidFallbackParams(params)) return null;

  const calculatedPrice = getPerPlayerPrice(
    params.time,
    params.duration,
    params.courtType,
    params.dateISO
  );
  return Number.isFinite(calculatedPrice) && calculatedPrice > 0 ? calculatedPrice : null;
}

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

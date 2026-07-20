export const CLUB_TIME_ZONE = 'Europe/Moscow';

const DATE_ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

const moscowDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLUB_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const pad2 = (value) => String(value).padStart(2, '0');

function parseDateISO(dateISO) {
  const match = typeof dateISO === 'string' ? DATE_ISO_PATTERN.exec(dateISO) : null;
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12));

  if (
    anchor.getUTCFullYear() !== year
    || anchor.getUTCMonth() !== month - 1
    || anchor.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day, anchor };
}

function getMoscowParts(instant = Date.now()) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) return null;

  const parts = Object.fromEntries(
    moscowDateTimeFormatter
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)])
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour % 24,
    minute: parts.minute,
    second: parts.second,
  };
}

export function getMoscowDateISO(instant = Date.now()) {
  const parts = getMoscowParts(instant);
  if (!parts) return null;
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function addDaysToDateISO(dateISO, days) {
  const parsed = parseDateISO(dateISO);
  if (!parsed || !Number.isInteger(days)) return null;

  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days, 12));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export function getMoscowDateRange(days = 14, instant = Date.now()) {
  const firstDateISO = getMoscowDateISO(instant);
  if (!firstDateISO || !Number.isInteger(days) || days < 0) return [];

  return Array.from({ length: days }, (_, index) => addDaysToDateISO(firstDateISO, index));
}

export function formatMoscowDateISO(dateISO, options, locale = 'ru-RU') {
  const parsed = parseDateISO(dateISO);
  if (!parsed) return '';

  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: CLUB_TIME_ZONE,
  }).format(parsed.anchor);
}

export function hasMoscowSlotStarted(dateISO, time, instant = Date.now()) {
  const parsedDate = parseDateISO(dateISO);
  const timeMatch = typeof time === 'string' ? TIME_PATTERN.exec(time) : null;
  const now = getMoscowParts(instant);
  if (!parsedDate || !timeMatch || !now) return true;

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return true;

  const todayISO = `${now.year}-${pad2(now.month)}-${pad2(now.day)}`;
  if (dateISO < todayISO) return true;
  if (dateISO > todayISO) return false;

  const slotSecond = (hour * 60 + minute) * 60;
  const currentSecond = (now.hour * 60 + now.minute) * 60 + now.second;
  return slotSecond <= currentSecond;
}

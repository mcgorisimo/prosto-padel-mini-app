export const PRIVATE_BOOKING_SLOT_MINUTES = 30;
export const MIN_PRIVATE_BOOKING_SLOTS = 2;
export const MAX_PRIVATE_BOOKING_SLOTS = 5;

const WORKING_DAY_END_MINUTE = 24 * 60;

function isAlignedMinute(value) {
  return Number.isInteger(value) && value % PRIVATE_BOOKING_SLOT_MINUTES === 0;
}

export function getPrivateBookingRangeEndMinute(range) {
  if (
    !range ||
    !isAlignedMinute(range.startMinute) ||
    !Number.isInteger(range.slotCount) ||
    range.slotCount < 1
  ) {
    return null;
  }
  return range.startMinute + range.slotCount * PRIVATE_BOOKING_SLOT_MINUTES;
}

export function getPrivateBookingDuration(range) {
  return (range?.slotCount * PRIVATE_BOOKING_SLOT_MINUTES) / 60;
}

export function formatPrivateBookingMinute(minute) {
  if (
    !isAlignedMinute(minute) ||
    minute < 0 ||
    minute > WORKING_DAY_END_MINUTE
  ) {
    return '';
  }
  if (minute === WORKING_DAY_END_MINUTE) return '00:00';
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function isPrivateBookingRangeWithinDay(range) {
  const endMinute = getPrivateBookingRangeEndMinute(range);
  return endMinute !== null && endMinute <= WORKING_DAY_END_MINUTE;
}

export function doesPrivateBookingOptionCoverRange(
  option,
  range,
  exact = false,
) {
  if (!option || !range || option.startMinute !== range.startMinute)
    return false;
  if (!Number.isInteger(option.durationSlots) || option.durationSlots < 1)
    return false;
  return exact
    ? option.durationSlots === range.slotCount
    : option.durationSlots >= range.slotCount;
}

export function findPrivateBookingRangeOption(
  options,
  range,
  { exact = false, preferredCourtId = null } = {},
) {
  if (!Array.isArray(options) || !isPrivateBookingRangeWithinDay(range))
    return null;
  const candidates = options.filter((option) =>
    doesPrivateBookingOptionCoverRange(option, range, exact),
  );
  if (preferredCourtId !== null) {
    const preferred = candidates.find(
      (option) => option.court?.id === preferredCourtId,
    );
    if (preferred) return preferred;
  }
  return candidates[0] ?? null;
}

export function isPrivateBookingTileCovered(options, minute) {
  if (!Array.isArray(options) || !isAlignedMinute(minute)) return false;
  return options.some(
    (option) =>
      isAlignedMinute(option?.startMinute) &&
      Number.isInteger(option?.durationSlots) &&
      option.durationSlots >= MIN_PRIVATE_BOOKING_SLOTS &&
      minute >= option.startMinute &&
      minute <
        option.startMinute +
          option.durationSlots * PRIVATE_BOOKING_SLOT_MINUTES,
  );
}

function nextRangeAfterRemoval(range, targetMinute) {
  const endMinute = getPrivateBookingRangeEndMinute(range);
  if (range.slotCount === 1) return null;
  if (targetMinute === range.startMinute) {
    return {
      startMinute: range.startMinute + PRIVATE_BOOKING_SLOT_MINUTES,
      slotCount: range.slotCount - 1,
    };
  }
  if (targetMinute === endMinute - PRIVATE_BOOKING_SLOT_MINUTES) {
    return { startMinute: range.startMinute, slotCount: range.slotCount - 1 };
  }
  return undefined;
}

export function updatePrivateBookingRange({ range, targetMinute, options }) {
  if (!isAlignedMinute(targetMinute)) {
    return { outcome: 'rejected', reason: 'unavailable', range };
  }

  if (!range) {
    const nextRange = { startMinute: targetMinute, slotCount: 1 };
    const option = findPrivateBookingRangeOption(options, {
      ...nextRange,
      slotCount: MIN_PRIVATE_BOOKING_SLOTS,
    });
    if (!option) {
      return { outcome: 'rejected', reason: 'minimum', range: null };
    }
    return {
      outcome: 'selected',
      range: { ...nextRange, courtId: option.court.id },
      option,
    };
  }

  const endMinute = getPrivateBookingRangeEndMinute(range);
  const isInside =
    targetMinute >= range.startMinute && targetMinute < endMinute;
  if (isInside) {
    const nextRange = nextRangeAfterRemoval(range, targetMinute);
    if (nextRange === undefined) {
      return { outcome: 'rejected', reason: 'gap', range };
    }
    if (nextRange === null) return { outcome: 'cleared', range: null };
    const option = findPrivateBookingRangeOption(options, nextRange, {
      preferredCourtId: range.courtId,
    });
    if (!option) {
      return { outcome: 'rejected', reason: 'unavailable', range };
    }
    return {
      outcome: 'selected',
      range: { ...nextRange, courtId: option.court.id },
      option,
    };
  }

  const isBefore =
    targetMinute === range.startMinute - PRIVATE_BOOKING_SLOT_MINUTES;
  const isAfter = targetMinute === endMinute;
  if (!isBefore && !isAfter) {
    return { outcome: 'rejected', reason: 'gap', range };
  }
  if (range.slotCount >= MAX_PRIVATE_BOOKING_SLOTS) {
    return { outcome: 'rejected', reason: 'maximum', range };
  }

  const nextRange = {
    startMinute: isBefore ? targetMinute : range.startMinute,
    slotCount: range.slotCount + 1,
  };
  const option = findPrivateBookingRangeOption(options, nextRange, {
    preferredCourtId: range.courtId,
  });
  if (!option) {
    return { outcome: 'rejected', reason: 'unavailable', range };
  }
  return {
    outcome: 'selected',
    range: { ...nextRange, courtId: option.court.id },
    option,
  };
}

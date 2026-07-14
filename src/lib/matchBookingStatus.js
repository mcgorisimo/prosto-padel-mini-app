const BOOKED_STATUSES = new Set(['booked', 'confirmed', 'reserved', 'paid']);

export function getMatchBookingStatus(match = {}) {
  const scenario = match.scenario;
  const bookingStatus = match.bookingStatus ?? match.booking_status;
  const isPrivate = match.isPrivate === true || match.is_private === true || scenario === 'private';
  const hasBookedFlag =
    match.isBooked === true ||
    match.is_booked === true ||
    match.bookingConfirmed === true ||
    match.booking_confirmed === true ||
    BOOKED_STATUSES.has(String(bookingStatus || '').toLowerCase());

  const isCommunityOnly = scenario === 'community' && !hasBookedFlag && !isPrivate;
  const isBooked = !isCommunityOnly && (
    hasBookedFlag ||
    scenario === 'social' ||
    isPrivate ||
    match.paymentStatus === 'full'
  );

  return {
    isBooked,
    label: isBooked ? 'Корт забронирован' : 'Не забронировано',
  };
}

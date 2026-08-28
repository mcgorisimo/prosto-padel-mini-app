const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function readTelegramNotificationDeepLink(search) {
  if (typeof search !== 'string' || search.length > 2_048) return null;
  const params = new URLSearchParams(search);
  const screen = params.get('pp_screen');
  if (screen === 'match') {
    const matchId = params.get('pp_match_id');
    return UUID_PATTERN.test(matchId ?? '')
      ? Object.freeze({ screen, matchId })
      : null;
  }
  if (screen === 'booking') {
    const reservationId = params.get('pp_reservation_id');
    return UUID_PATTERN.test(reservationId ?? '')
      ? Object.freeze({ screen, reservationId })
      : null;
  }
  return null;
}

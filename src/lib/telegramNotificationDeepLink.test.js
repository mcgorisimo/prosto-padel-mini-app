import { describe, expect, it } from 'vitest';
import { readTelegramNotificationDeepLink } from './telegramNotificationDeepLink';

const MATCH_ID = 'd608661e-0da8-4c82-875f-740f5e0e871a';
const RESERVATION_ID = 'e4158559-3d7a-4fc9-baad-66a0da075208';

describe('readTelegramNotificationDeepLink', () => {
  it('accepts only allowlisted match and booking destinations', () => {
    expect(
      readTelegramNotificationDeepLink(
        `?pp_screen=match&pp_match_id=${MATCH_ID}`,
      ),
    ).toEqual({ screen: 'match', matchId: MATCH_ID });
    expect(
      readTelegramNotificationDeepLink(
        `?pp_screen=booking&pp_reservation_id=${RESERVATION_ID}`,
      ),
    ).toEqual({ screen: 'booking', reservationId: RESERVATION_ID });
  });

  it.each([
    '?pp_screen=match&pp_match_id=bad',
    `?pp_screen=admin&pp_match_id=${MATCH_ID}`,
    `?pp_screen=booking&pp_match_id=${MATCH_ID}`,
    `?pp_screen=match&pp_reservation_id=${RESERVATION_ID}`,
  ])('rejects unsafe or mismatched input %s', (search) => {
    expect(readTelegramNotificationDeepLink(search)).toBeNull();
  });
});

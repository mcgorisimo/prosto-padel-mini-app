import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from '../auth/auth.types';
import { MatchNotificationId } from './match-notification.types';
import {
  readMarkMatchNotificationRequest,
  readMatchNotificationId,
  readMatchNotificationsRequest,
} from './match-notification.http';

const NOTIFICATION_ID = deterministicUuid(
  'notification-http-id',
) as MatchNotificationId;
const NOW = unixEpochSeconds(1_800_000_000);

describe('match notification HTTP parsing', () => {
  it('reads defaults and an exact keyset cursor', () => {
    expect(readMatchNotificationsRequest({})).toEqual({ limit: 50 });
    expect(readMatchNotificationsRequest({
      limit: '20',
      beforeCreatedAt: String(NOW),
      beforeNotificationId: NOTIFICATION_ID,
    })).toEqual({
      limit: 20,
      before: {
        createdAt: NOW,
        notificationId: NOTIFICATION_ID,
      },
    });
  });

  it('rejects partial cursors, unknown fields and invalid limits', () => {
    expect(readMatchNotificationsRequest({
      beforeCreatedAt: String(NOW),
    })).toBeUndefined();
    expect(readMatchNotificationsRequest({ limit: '51' })).toBeUndefined();
    expect(readMatchNotificationsRequest({ private: 'value' })).toBeUndefined();
  });

  it('accepts only an absent or exact empty mark-read body', () => {
    expect(readMarkMatchNotificationRequest(undefined)).toEqual({});
    expect(readMarkMatchNotificationRequest({})).toEqual({});
    expect(readMarkMatchNotificationRequest({ requestKey: 'private' }))
      .toBeUndefined();
    expect(readMatchNotificationId(NOTIFICATION_ID)).toBe(NOTIFICATION_ID);
    expect(readMatchNotificationId('invalid')).toBeUndefined();
  });
});

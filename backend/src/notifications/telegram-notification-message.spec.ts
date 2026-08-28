import { TELEGRAM_NOTIFICATION_EVENT_TYPES } from './telegram-notification-intent.types';
import { renderTelegramNotificationMessage } from './telegram-notification-message';

describe('renderTelegramNotificationMessage', () => {
  it.each(TELEGRAM_NOTIFICATION_EVENT_TYPES)(
    'renders safe fixed text for %s',
    (eventType) => {
      const message = renderTelegramNotificationMessage({ eventType });
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(
        /phone|email|token|proof|paymentStatus|PRIVATE_/iu,
      );
    },
  );
});

import {
  ClaimedTelegramNotificationIntent,
  TelegramNotificationEventType,
} from './telegram-notification-intent.types';

const MESSAGES: Readonly<Record<TelegramNotificationEventType, string>> =
  Object.freeze({
    match_invited:
      'Вас пригласили в матч. Откройте «Просто Падел», чтобы посмотреть детали.',
    waitlist_slot_available:
      'В матче освободилось место. Откройте «Просто Падел» и подтвердите участие в течение 15 минут.',
    match_schedule_changed:
      'Дата, время или корт матча изменились. Проверьте актуальные детали в «Просто Падел».',
    match_cancelled:
      'Матч отменён. Откройте «Просто Падел», чтобы посмотреть актуальную информацию.',
    participant_joined:
      'К вашему матчу присоединился игрок. Откройте «Просто Падел», чтобы посмотреть состав.',
    participant_left:
      'Игрок вышел из вашего матча. Откройте «Просто Падел», чтобы посмотреть состав.',
    chat_message_created:
      'В чате матча новое сообщение. Откройте «Просто Падел», чтобы прочитать его.',
    match_reminder_24h:
      'До матча осталось около 24 часов. Проверьте детали в «Просто Падел».',
    match_reminder_2h:
      'До матча осталось около 2 часов. Проверьте детали в «Просто Падел».',
    reservation_confirmed:
      'Бронь подтверждена. Откройте «Просто Падел», чтобы посмотреть детали.',
    reservation_rescheduled:
      'Администратор перенёс бронь. Проверьте актуальные детали в «Просто Падел».',
    reservation_cancelled:
      'Администратор отменил бронь. Откройте «Просто Падел», чтобы посмотреть актуальную информацию.',
  });

export function renderTelegramNotificationMessage(
  intent: Pick<ClaimedTelegramNotificationIntent, 'eventType'>,
): string {
  return MESSAGES[intent.eventType];
}

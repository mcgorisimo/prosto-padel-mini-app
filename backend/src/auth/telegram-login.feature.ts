import type { TelegramLoginService } from './telegram-login.service';

export const TELEGRAM_LOGIN_FEATURE = Symbol('TELEGRAM_LOGIN_FEATURE');

export type TelegramLoginFeature =
  | Readonly<{
      enabled: false;
    }>
  | Readonly<{
      enabled: true;
      service: TelegramLoginService;
    }>;

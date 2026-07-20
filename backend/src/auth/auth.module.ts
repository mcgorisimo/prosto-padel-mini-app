import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramInitDataVerifier } from './telegram-init-data.verifier';

@Module({
  providers: [
    {
      provide: TelegramInitDataVerifier,
      inject: [ConfigService],
      useFactory: (config: ConfigService): TelegramInitDataVerifier => {
        const enabled = config.getOrThrow<boolean>('TELEGRAM_AUTH_ENABLED');

        if (!enabled) {
          return new TelegramInitDataVerifier({ enabled: false });
        }

        return new TelegramInitDataVerifier({
          enabled: true,
          botToken: config.getOrThrow<string>('TELEGRAM_BOT_TOKEN'),
          maxAgeSeconds: config.getOrThrow<number>(
            'TELEGRAM_INIT_DATA_MAX_AGE_SECONDS',
          ),
        });
      },
    },
  ],
})
export class AuthModule {}

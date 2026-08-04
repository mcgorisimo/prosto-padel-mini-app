import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import fastifyCookie from '@fastify/cookie';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { PLAYER_PROFILE_PHOTO_MAX_UPLOAD_BYTES } from './config/player-profile-photo.config';

export function registerPlayerProfilePhotoContentTypes(
  application: NestFastifyApplication,
): void {
  application.getHttpAdapter().getInstance().addContentTypeParser(
    ['image/jpeg', 'image/png', 'image/webp'],
    {
      parseAs: 'buffer',
      bodyLimit: PLAYER_PROFILE_PHOTO_MAX_UPLOAD_BYTES,
    },
    (_request, body, done) => {
      done(null, body);
    },
  );
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  const config = app.get(ConfigService);

  registerPlayerProfilePhotoContentTypes(app);
  await app.register(fastifyCookie);
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  await app.listen(
    config.getOrThrow<number>('PORT'),
    config.getOrThrow<string>('HOST'),
  );
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error(error instanceof Error ? error.message : 'Backend failed to start');
  process.exitCode = 1;
});

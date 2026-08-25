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
import { registerBackendHttpLogging } from './common/logging/backend-http-logging';
import { createBackendConsoleLogger } from './common/logging/backend-console-logger';

export function registerPlayerProfilePhotoContentTypes(
  application: NestFastifyApplication,
): void {
  application
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser(
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
    {
      logger: createBackendConsoleLogger(),
    },
  );
  const config = app.get(ConfigService);

  registerPlayerProfilePhotoContentTypes(app);
  await app.register(fastifyCookie);
  registerBackendHttpLogging(app);
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  await app.listen(
    config.getOrThrow<number>('PORT'),
    config.getOrThrow<string>('HOST'),
  );
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error({
    event: 'backend_bootstrap_failed',
    outcome: 'failure',
    errorKind: error instanceof Error ? 'error' : 'unknown_throwable',
  });
  process.exitCode = 1;
});

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createRuntimeConfigurationLoader } from './runtime-environment';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      ignoreEnvFile: process.env.BACKEND_IGNORE_ENV_FILE === 'true',
      isGlobal: true,
      load: [createRuntimeConfigurationLoader()],
      skipProcessEnv: true,
    }),
  ],
})
export class AppConfigModule {}

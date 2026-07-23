import { Module } from '@nestjs/common';
import { PostgresService } from './postgres.service';
import { PostgresTransactionRunner } from './postgres-transaction';

@Module({
  providers: [PostgresService, PostgresTransactionRunner],
  exports: [PostgresTransactionRunner],
})
export class DatabaseModule {}

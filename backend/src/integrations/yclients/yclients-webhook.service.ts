import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  readYclientsWebhookConfiguration,
  YclientsWebhookConfiguration,
} from '../../config/yclients-webhook.config';
import { PostgresYclientsWebhookSignalRepository } from '../../database/postgres-yclients-webhook-signal.repository';
import { PostgresTransactionRunner } from '../../database/postgres-transaction';
import { RecordYclientsWebhookSignalOutcome } from '../../database/yclients-webhook-signal.repository';
import {
  YclientsRecordEventType,
  YclientsRecordWebhookSignal,
} from './yclients-webhook.types';

export class YclientsWebhookNotAvailableError extends Error {}
export class YclientsWebhookPersistenceError extends Error {}

export interface AcceptYclientsRecordWebhookInput {
  readonly companyId: number;
  readonly recordId: number;
  readonly eventType: YclientsRecordEventType;
}

@Injectable()
export class YclientsWebhookService {
  private readonly configuration: YclientsWebhookConfiguration;

  constructor(
    config: ConfigService,
    private readonly transactions: PostgresTransactionRunner,
    private readonly signals: PostgresYclientsWebhookSignalRepository,
  ) {
    this.configuration = readYclientsWebhookConfiguration(config);
  }

  async acceptRecordSignal(
    input: AcceptYclientsRecordWebhookInput,
  ): Promise<void> {
    if (
      !this.configuration.enabled ||
      this.configuration.companyId === undefined ||
      input.companyId !== this.configuration.companyId
    ) {
      throw new YclientsWebhookNotAvailableError();
    }

    const signal: YclientsRecordWebhookSignal = Object.freeze({
      companyId: input.companyId,
      recordId: input.recordId,
      eventType: input.eventType,
      receivedAt: Math.floor(Date.now() / 1_000),
    });

    let outcome: RecordYclientsWebhookSignalOutcome;
    try {
      outcome = await this.transactions.runInTransaction((transaction) =>
        this.signals.recordSignal(transaction, signal),
      );
    } catch {
      throw new YclientsWebhookPersistenceError();
    }

    if (outcome !== 'recorded') {
      throw new YclientsWebhookPersistenceError();
    }
  }
}

import { ConfigService } from '@nestjs/config';
import { PostgresYclientsWebhookSignalRepository } from '../../database/postgres-yclients-webhook-signal.repository';
import {
  PostgresTransaction,
  PostgresTransactionRunner,
} from '../../database/postgres-transaction';
import { RecordYclientsWebhookSignalOutcome } from '../../database/yclients-webhook-signal.repository';
import {
  YclientsWebhookNotAvailableError,
  YclientsWebhookPersistenceError,
  YclientsWebhookService,
} from './yclients-webhook.service';

const NOW_MILLISECONDS = 1_800_000_000_999;
const transaction = Object.freeze({ query: jest.fn() }) as unknown as PostgresTransaction;

function harness(environment: Record<string, unknown>) {
  const recordSignal = jest
    .fn<
      Promise<RecordYclientsWebhookSignalOutcome>,
      [PostgresTransaction, unknown]
    >()
    .mockResolvedValue('recorded');
  const runInTransaction = jest.fn(async (operation) => operation(transaction));
  const service = new YclientsWebhookService(
    new ConfigService(environment),
    { runInTransaction } as unknown as PostgresTransactionRunner,
    { recordSignal } as unknown as PostgresYclientsWebhookSignalRepository,
  );
  return { service, runInTransaction, recordSignal };
}

describe('YclientsWebhookService', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MILLISECONDS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists an allowlisted company signal with server time', async () => {
    const test = harness({
      YCLIENTS_WEBHOOK_ENABLED: true,
      YCLIENTS_COMPANY_ID: 123,
    });

    await expect(test.service.acceptRecordSignal({
      companyId: 123,
      recordId: 456,
      eventType: 'create',
    })).resolves.toBeUndefined();

    expect(test.recordSignal).toHaveBeenCalledWith(transaction, {
      companyId: 123,
      recordId: 456,
      eventType: 'create',
      receivedAt: 1_800_000_000,
    });
    expect(test.runInTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['disabled', { YCLIENTS_WEBHOOK_ENABLED: false, YCLIENTS_COMPANY_ID: 123 }, 123],
    ['missing company', { YCLIENTS_WEBHOOK_ENABLED: true }, 123],
    ['foreign company', { YCLIENTS_WEBHOOK_ENABLED: true, YCLIENTS_COMPANY_ID: 123 }, 124],
  ])('hides the endpoint when %s', async (_description, environment, companyId) => {
    const test = harness(environment);

    await expect(test.service.acceptRecordSignal({
      companyId,
      recordId: 456,
      eventType: 'update',
    })).rejects.toBeInstanceOf(YclientsWebhookNotAvailableError);
    expect(test.runInTransaction).not.toHaveBeenCalled();
    expect(test.recordSignal).not.toHaveBeenCalled();
  });

  it('maps storage failures without exposing their details', async () => {
    const test = harness({
      YCLIENTS_WEBHOOK_ENABLED: true,
      YCLIENTS_COMPANY_ID: 123,
    });
    test.recordSignal.mockRejectedValueOnce(
      new Error('PRIVATE_DATABASE_FAILURE_DETAIL'),
    );

    let capturedError: unknown;
    try {
      await test.service.acceptRecordSignal({
        companyId: 123,
        recordId: 456,
        eventType: 'delete',
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(YclientsWebhookPersistenceError);
    expect((capturedError as Error).message).not.toContain(
      'PRIVATE_DATABASE_FAILURE_DETAIL',
    );
  });

  it('fails closed when the bounded inbox has no capacity', async () => {
    const test = harness({
      YCLIENTS_WEBHOOK_ENABLED: true,
      YCLIENTS_COMPANY_ID: 123,
    });
    test.recordSignal.mockResolvedValueOnce('capacity_exceeded');

    await expect(
      test.service.acceptRecordSignal({
        companyId: 123,
        recordId: 789,
        eventType: 'create',
      }),
    ).rejects.toBeInstanceOf(YclientsWebhookPersistenceError);
  });
});

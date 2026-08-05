import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { YclientsWebhookController } from './yclients-webhook.controller';
import {
  YclientsWebhookNotAvailableError,
  YclientsWebhookPersistenceError,
  YclientsWebhookService,
} from './yclients-webhook.service';

const PRIVATE_MARKER = 'PRIVATE_YCLIENTS_CUSTOMER_VALUE';

interface Harness {
  readonly app: NestFastifyApplication;
  readonly acceptRecordSignal: jest.Mock<Promise<void>, [unknown]>;
  readonly logs: readonly unknown[][];
}

async function createHarness(): Promise<Harness> {
  const acceptRecordSignal = jest
    .fn<Promise<void>, [unknown]>()
    .mockResolvedValue(undefined);
  const moduleRef = await Test.createTestingModule({
    controllers: [YclientsWebhookController],
    providers: [
      {
        provide: YclientsWebhookService,
        useValue: { acceptRecordSignal },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  const logs: unknown[][] = [];
  const capture = (...values: unknown[]) => logs.push(values);
  app.useLogger({
    log: capture,
    error: capture,
    warn: capture,
    debug: capture,
    verbose: capture,
    fatal: capture,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, acceptRecordSignal, logs };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    company_id: 123,
    resource: 'record',
    resource_id: 456,
    status: 'update',
    data: {
      client: { phone: PRIVATE_MARKER },
      comment: PRIVATE_MARKER,
    },
    ...overrides,
  };
}

describe('YclientsWebhookController', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
  });

  it('accepts a record signal without forwarding private data', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/integrations/yclients/webhook',
      payload: payload(),
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(harness.acceptRecordSignal).toHaveBeenCalledWith({
      companyId: 123,
      recordId: 456,
      eventType: 'update',
    });
    expect(JSON.stringify(harness.acceptRecordSignal.mock.calls)).not.toContain(
      PRIVATE_MARKER,
    );
    expect(JSON.stringify(harness.logs)).not.toContain(PRIVATE_MARKER);
  });

  it.each([
    ['non-object body', null],
    ['unsafe company', payload({ company_id: Number.MAX_SAFE_INTEGER + 1 })],
    ['wrong resource', payload({ resource: 'client' })],
    ['unsafe record', payload({ resource_id: 0 })],
    ['wrong status', payload({ status: 'restore' })],
    ['missing data object', payload({ data: null })],
  ])('rejects %s before the service', async (_description, body) => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/integrations/yclients/webhook',
      headers: {
        'content-type': 'application/json',
      },
      payload: body === null ? 'null' : body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'YCLIENTS_WEBHOOK_INVALID',
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(harness.acceptRecordSignal).not.toHaveBeenCalled();
    expect(JSON.stringify(response.json())).not.toContain(PRIVATE_MARKER);
  });

  it.each([
    [new YclientsWebhookNotAvailableError(), 404, 'YCLIENTS_WEBHOOK_NOT_AVAILABLE'],
    [new YclientsWebhookPersistenceError(), 503, 'YCLIENTS_WEBHOOK_UNAVAILABLE'],
  ] as const)('maps expected failures to safe responses', async (error, status, code) => {
    harness.acceptRecordSignal.mockRejectedValueOnce(error);

    const response = await harness.app.inject({
      method: 'POST',
      url: '/integrations/yclients/webhook',
      payload: payload(),
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code });
    expect(JSON.stringify(response.json())).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(harness.logs)).not.toContain(PRIVATE_MARKER);
  });

  it('does not collapse unexpected programmer errors', async () => {
    const controller = new YclientsWebhookController({
      acceptRecordSignal: jest.fn().mockRejectedValue(new Error('unexpected')),
    } as unknown as YclientsWebhookService);
    const reply = {
      header: jest.fn(),
    };

    await expect(
      controller.accept(payload(), reply as never),
    ).rejects.toThrow('unexpected');
    expect(reply.header).toHaveBeenCalledTimes(2);
  });
});

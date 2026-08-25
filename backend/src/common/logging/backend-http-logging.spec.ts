import { Controller, Get, HttpException, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { setImmediate } from 'node:timers/promises';
import { isInternalUuid } from '../internal-uuid';
import { registerBackendHttpLogging } from './backend-http-logging';
import { LoggingModule } from './logging.module';
import { RequestContextStore } from './request-context.store';
import { REQUEST_ID_HEADER } from './request-id';

const AUTHORIZATION_MARKER = 'Bearer secret-authorization-marker';
const QUERY_MARKER = 'secret-query-marker';
const ERROR_MARKER = 'secret-error-marker';
const PUBLIC_ERROR_MARKER = 'public-error-marker';
const PUBLIC_SERVER_ERROR_MARKER = 'public-server-error-marker';
const RELEASE = '0123456789abcdef0123456789abcdef01234567';

type CapturedLog = Readonly<{
  level: 'log' | 'warn' | 'error' | 'debug' | 'verbose' | 'fatal';
  arguments: readonly unknown[];
}>;

function captureLogger(entries: CapturedLog[]): LoggerService {
  const capture =
    (level: CapturedLog['level']) =>
    (message: unknown, ...optionalParameters: unknown[]): void => {
      entries.push({
        level,
        arguments: [message, ...optionalParameters],
      });
    };

  return {
    log: capture('log'),
    warn: capture('warn'),
    error: capture('error'),
    debug: capture('debug'),
    verbose: capture('verbose'),
    fatal: capture('fatal'),
  };
}

function serializedLogs(entries: readonly CapturedLog[]): string {
  return JSON.stringify(entries, (_key, value: unknown) => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }
    return value;
  });
}

@Controller()
class LoggingTestController {
  constructor(private readonly requestContexts: RequestContextStore) {}

  @Get('ok')
  ok(): Readonly<{ ok: true }> {
    return Object.freeze({ ok: true });
  }

  @Get('context')
  async context(): Promise<Readonly<{ requestId: string | undefined }>> {
    await setImmediate();
    return Object.freeze({ requestId: this.requestContexts.requestId() });
  }

  @Get('failure')
  failure(): never {
    throw new Error(ERROR_MARKER);
  }

  @Get('public-error')
  publicError(): never {
    throw new HttpException(
      Object.freeze({
        statusCode: 409,
        code: 'logging_test_conflict',
        message: PUBLIC_ERROR_MARKER,
      }),
      409,
    );
  }

  @Get('public-server-error')
  publicServerError(): never {
    throw new HttpException(
      Object.freeze({
        statusCode: 503,
        code: 'logging_test_service_unavailable',
        message: PUBLIC_SERVER_ERROR_MARKER,
      }),
      503,
    );
  }

  @Get('health')
  health(): Readonly<{ status: 'ok' }> {
    return Object.freeze({ status: 'ok' });
  }
}

describe('backend HTTP logging', () => {
  let application: NestFastifyApplication | undefined;
  const entries: CapturedLog[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggingModule],
      controllers: [LoggingTestController],
      providers: [
        {
          provide: ConfigService,
          useValue: {
            getOrThrow(key: string): string {
              if (key === 'NODE_ENV') return 'test';
              if (key === 'APP_RELEASE') return RELEASE;
              throw new TypeError('Unexpected test configuration key');
            },
          },
        },
      ],
    }).compile();

    application = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    application.useLogger(captureLogger(entries));
    application.setGlobalPrefix('api/v1');
    registerBackendHttpLogging(application);
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
    entries.length = 0;
  });

  afterAll(async () => {
    await application?.close();
  });

  it('generates a request ID and logs only the route template', async () => {
    const response = await application?.inject({
      method: 'GET',
      url: `/api/v1/ok?token=${QUERY_MARKER}`,
      headers: {
        authorization: AUTHORIZATION_MARKER,
        [REQUEST_ID_HEADER]: 'client-controlled-request-id',
      },
    });
    await setImmediate();

    expect(response?.statusCode).toBe(200);
    const requestId = response?.headers[REQUEST_ID_HEADER];
    expect(isInternalUuid(requestId)).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('log');
    expect(entries[0]?.arguments[0]).toMatchObject({
      event: 'http_request_completed',
      service: 'prosto-padel-backend',
      environment: 'test',
      release: RELEASE,
      requestId,
      method: 'GET',
      route: '/api/v1/ok',
      statusCode: 200,
      outcome: 'success',
    });
    expect(serializedLogs(entries)).not.toContain(AUTHORIZATION_MARKER);
    expect(serializedLogs(entries)).not.toContain(QUERY_MARKER);
  });

  it('does not trust a canonical client-supplied request ID', async () => {
    entries.length = 0;
    const clientRequestId = '22345678-1234-4567-9234-567812345678';
    const response = await application?.inject({
      method: 'GET',
      url: '/api/v1/ok',
      headers: { [REQUEST_ID_HEADER]: clientRequestId },
    });
    await setImmediate();

    const assignedRequestId = response?.headers[REQUEST_ID_HEADER];
    expect(isInternalUuid(assignedRequestId)).toBe(true);
    expect(assignedRequestId).not.toBe(clientRequestId);
    expect(serializedLogs(entries)).not.toContain(clientRequestId);
  });

  it('keeps concurrent request contexts isolated', async () => {
    entries.length = 0;
    const [first, second] = await Promise.all([
      application?.inject({
        method: 'GET',
        url: '/api/v1/context',
      }),
      application?.inject({
        method: 'GET',
        url: '/api/v1/context',
      }),
    ]);

    const firstRequestId = first?.headers[REQUEST_ID_HEADER];
    const secondRequestId = second?.headers[REQUEST_ID_HEADER];
    expect(isInternalUuid(firstRequestId)).toBe(true);
    expect(isInternalUuid(secondRequestId)).toBe(true);
    expect(secondRequestId).not.toBe(firstRequestId);
    expect(first?.json()).toEqual({ requestId: firstRequestId });
    expect(second?.json()).toEqual({ requestId: secondRequestId });
  });

  it('sanitizes an unexpected error response and its log entry', async () => {
    entries.length = 0;
    const response = await application?.inject({
      method: 'GET',
      url: '/api/v1/failure',
    });
    await setImmediate();

    expect(response?.statusCode).toBe(500);
    expect(response?.json()).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]?.level).toBe('error');
    expect(entries[0]?.arguments[0]).toMatchObject({
      event: 'http_request_exception',
      service: 'prosto-padel-backend',
      environment: 'test',
      release: RELEASE,
      requestId: response?.headers[REQUEST_ID_HEADER],
      statusCode: 500,
      outcome: 'failure',
      errorKind: 'error',
      errorCode: 'unclassified_error',
    });
    expect(entries[1]?.level).toBe('error');
    expect(entries[1]?.arguments[0]).toMatchObject({
      event: 'http_request_completed',
      statusCode: 500,
      outcome: 'failure',
    });
    expect(serializedLogs(entries)).not.toContain(ERROR_MARKER);
  });

  it('preserves an intentional public HttpException without logging its body', async () => {
    entries.length = 0;
    const response = await application?.inject({
      method: 'GET',
      url: '/api/v1/public-error',
    });
    await setImmediate();

    expect(response?.statusCode).toBe(409);
    expect(response?.json()).toEqual({
      statusCode: 409,
      code: 'logging_test_conflict',
      message: PUBLIC_ERROR_MARKER,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('warn');
    expect(entries[0]?.arguments[0]).toMatchObject({
      statusCode: 409,
      outcome: 'rejected',
    });
    expect(serializedLogs(entries)).not.toContain(PUBLIC_ERROR_MARKER);
  });

  it('logs only the bounded public code for a server HttpException', async () => {
    entries.length = 0;
    const response = await application?.inject({
      method: 'GET',
      url: '/api/v1/public-server-error',
    });
    await setImmediate();

    expect(response?.statusCode).toBe(503);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.arguments[0]).toMatchObject({
      event: 'http_request_exception',
      statusCode: 503,
      errorKind: 'http_exception',
      errorCode: 'logging_test_service_unavailable',
    });
    expect(entries[1]?.arguments[0]).toMatchObject({
      event: 'http_request_completed',
      statusCode: 503,
      outcome: 'failure',
    });
    expect(serializedLogs(entries)).not.toContain(PUBLIC_SERVER_ERROR_MARKER);
  });

  it('suppresses successful health-check noise', async () => {
    entries.length = 0;
    const response = await application?.inject({
      method: 'GET',
      url: '/api/v1/health',
    });
    await setImmediate();

    expect(response?.statusCode).toBe(200);
    expect(entries).toEqual([]);
  });
});

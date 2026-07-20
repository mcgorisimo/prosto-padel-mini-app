import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { PostgresService } from '../src/database/postgres.service';

jest.mock('pg', () => ({
  Pool: jest.fn(),
}));

const originalEnvironment = {
  BACKEND_IGNORE_ENV_FILE: process.env.BACKEND_IGNORE_ENV_FILE,
  DATABASE_ENABLED: process.env.DATABASE_ENABLED,
  DATABASE_URL: process.env.DATABASE_URL,
  HOST: process.env.HOST,
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
};

function restoreEnvironmentVariable(
  name: keyof typeof originalEnvironment,
): void {
  const originalValue = originalEnvironment[name];

  if (originalValue === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = originalValue;
}

describe('Health endpoint (e2e)', () => {
  let app: NestFastifyApplication | undefined;
  let postgres: PostgresService | undefined;

  beforeAll(async () => {
    process.env.BACKEND_IGNORE_ENV_FILE = 'true';
    process.env.DATABASE_ENABLED = 'false';
    process.env.DATABASE_URL = '';
    process.env.HOST = '127.0.0.1';
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3000';

    const { AppModule } = await import('../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    postgres = moduleFixture.get(PostgresService);

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api/v1');

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      restoreEnvironmentVariable('BACKEND_IGNORE_ENV_FILE');
      restoreEnvironmentVariable('DATABASE_ENABLED');
      restoreEnvironmentVariable('DATABASE_URL');
      restoreEnvironmentVariable('HOST');
      restoreEnvironmentVariable('NODE_ENV');
      restoreEnvironmentVariable('PORT');
    }
  });

  it('initializes with PostgreSQL disabled without creating a pool', () => {
    if (!postgres) {
      throw new Error('PostgreSQL service was not initialized');
    }

    expect(postgres.isEnabled()).toBe(false);
    expect(() => postgres?.getPool()).toThrow('PostgreSQL is disabled');
    expect(Pool).not.toHaveBeenCalled();
  });

  it('GET /api/v1/health returns a stable liveness response', async () => {
    if (!app) {
      throw new Error('Test application was not initialized');
    }

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'prosto-padel-backend',
    });
  });
});

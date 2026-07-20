import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { CrmAdapter } from '../src/integrations/crm/crm-adapter.interface';
import { CRM_ADAPTER } from '../src/integrations/crm/crm.tokens';

const originalEnvironment = {
  BACKEND_IGNORE_ENV_FILE: process.env.BACKEND_IGNORE_ENV_FILE,
  CRM_PROVIDER: process.env.CRM_PROVIDER,
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

describe('Backend module boundaries (e2e)', () => {
  let app: NestFastifyApplication | undefined;
  let crmAdapter: CrmAdapter | undefined;

  beforeAll(async () => {
    process.env.BACKEND_IGNORE_ENV_FILE = 'true';
    process.env.CRM_PROVIDER = 'disabled';
    process.env.DATABASE_ENABLED = 'false';
    process.env.DATABASE_URL = '';
    process.env.HOST = '127.0.0.1';
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3000';

    const { AppModule } = await import('../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    crmAdapter = moduleFixture.get<CrmAdapter>(CRM_ADAPTER);

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
      restoreEnvironmentVariable('CRM_PROVIDER');
      restoreEnvironmentVariable('DATABASE_ENABLED');
      restoreEnvironmentVariable('DATABASE_URL');
      restoreEnvironmentVariable('HOST');
      restoreEnvironmentVariable('NODE_ENV');
      restoreEnvironmentVariable('PORT');
      jest.restoreAllMocks();
    }
  });

  it('provides the disabled CRM adapter', () => {
    if (!crmAdapter) {
      throw new Error('CRM adapter was not initialized');
    }

    expect(crmAdapter.getProviderName()).toBe('disabled');
    expect(crmAdapter.isConfigured()).toBe(false);
  });

  it('keeps the health endpoint unchanged', async () => {
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

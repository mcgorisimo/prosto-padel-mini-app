import { DynamicModule, Logger, Module, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { inspect } from 'node:util';
import {
  externalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from '../accounts/external-identity.types';
import {
  TELEGRAM_LOGIN_CONFIG_KEYS,
  TELEGRAM_AUTH_OPERATION_TTL_SECONDS,
  TELEGRAM_SESSION_TTL_SECONDS,
} from '../config/telegram-login.config';
import { PostgresAccountStatusReader } from '../database/postgres-account-status.reader';
import { PostgresAuthenticationOperationTerminalRepository } from '../database/postgres-authentication-operation-terminal.repository';
import { PostgresExternalIdentityResolutionRepository } from '../database/postgres-external-identity.repository';
import { PostgresInitialSessionRepository } from '../database/postgres-initial-session.repository';
import { PostgresPlayerAccountProvisioningRepository } from '../database/postgres-player-account-provisioning.repository';
import { PostgresSecurityAuditRepository } from '../database/postgres-security-audit.repository';
import { PostgresService } from '../database/postgres.service';
import { PostgresTelegramAuthenticationOperationRepository } from '../database/postgres-telegram-authentication-operation.repository';
import { PostgresTransactionRunner } from '../database/postgres-transaction';
import { PostgresTransactionExecutorAdapter } from '../database/postgres-transaction-executor.adapter';
import {
  AuthenticationProofFingerprint,
  VerifiedTelegramProof,
  unixEpochSeconds,
} from './auth.types';
import { AuthModule } from './auth.module';
import { NodeSessionCredentialIssuer } from './session-credential-issuer.adapter';
import { TelegramLoginController } from './telegram-login.controller';
import { TelegramInitDataVerifier } from './telegram-init-data.verifier';
import {
  TELEGRAM_LOGIN_FEATURE,
  TelegramLoginFeature,
} from './telegram-login.feature';
import {
  TelegramLoginDiagnosticObserver,
  TelegramLoginService,
  TelegramLoginServiceDependencies,
} from './telegram-login.service';
import { DeterministicTelegramLoginWorkflowBindingsAdapter } from './telegram-login-workflow-bindings.adapter';
import { TelegramLookupDigestCandidatesAdapter } from './telegram-lookup-digest.adapter';

@Module({})
class TestConfigModule {}

const TEST_LOOKUP_PEPPER = Buffer.alloc(32, 0x31).toString('base64');
const TEST_WORKFLOW_SECRET = Buffer.alloc(32, 0x42).toString('base64');
const TEST_UUID_NAMESPACE = '12345678-1234-5678-9234-567812345678';
const TEST_BOT_TOKEN =
  '123456789:AA_TEST_ONLY_FAKE_TELEGRAM_BOT_TOKEN';
const NOW = unixEpochSeconds(1_800_000_000);
const FINGERPRINT = '55'.repeat(32) as AuthenticationProofFingerprint;

function configModule(values: Record<string, unknown>): DynamicModule {
  return {
    module: TestConfigModule,
    global: true,
    providers: [
      {
        provide: ConfigService,
        useValue: new ConfigService(values),
      },
    ],
    exports: [ConfigService],
  };
}

function enabledConfiguration(): Record<string, unknown> {
  return {
    DATABASE_ENABLED: true,
    DATABASE_URL: 'postgresql://test-only.invalid/prosto_padel',
    TELEGRAM_AUTH_ENABLED: true,
    TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
    TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: 300,
    [TELEGRAM_LOGIN_CONFIG_KEYS.lookupPepperBase64]: TEST_LOOKUP_PEPPER,
    [TELEGRAM_LOGIN_CONFIG_KEYS.workflowHmacSecretBase64]:
      TEST_WORKFLOW_SECRET,
    [TELEGRAM_LOGIN_CONFIG_KEYS.uuidNamespace]: TEST_UUID_NAMESPACE,
    [TELEGRAM_LOGIN_CONFIG_KEYS.digestVersion]: 1,
    [TELEGRAM_LOGIN_CONFIG_KEYS.pepperVersion]: 1,
    [TELEGRAM_LOGIN_CONFIG_KEYS.operationTtlSeconds]:
      TELEGRAM_AUTH_OPERATION_TTL_SECONDS,
    [TELEGRAM_LOGIN_CONFIG_KEYS.sessionTtlSeconds]:
      TELEGRAM_SESSION_TTL_SECONDS,
  };
}

function verifiedProof(): VerifiedTelegramProof {
  const namespace = externalIdentityNamespace('telegram:bot:123456');
  return {
    provider: 'telegram',
    namespace,
    identityKey: {
      provider: 'telegram',
      namespace,
      lookup: {
        kind: 'canonical_subject',
        subject:
          trustProviderCanonicalizedExternalIdentitySubject('987654321'),
      },
    },
    authDate: unixEpochSeconds(1_799_999_900),
    verifiedAt: NOW,
    expiresAt: unixEpochSeconds(1_800_001_000),
    proofFingerprint: FINGERPRINT,
  };
}

function signedInitData(
  parameters: ReadonlyArray<readonly [string, string]>,
): string {
  const dataCheckString = [...parameters]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData')
    .update(TEST_BOT_TOKEN, 'utf8')
    .digest();
  const hash = createHmac('sha256', secretKey)
    .update(dataCheckString, 'utf8')
    .digest('hex');

  return [...parameters, ['hash', hash] as const]
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    )
    .join('&');
}

async function compileAuthModule(
  values: Record<string, unknown>,
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [configModule(values), AuthModule],
  }).compile();
}

function getFeature(moduleRef: TestingModule): TelegramLoginFeature {
  return moduleRef.get<TelegramLoginFeature>(TELEGRAM_LOGIN_FEATURE);
}

function getServiceDependencies(
  service: TelegramLoginService,
): TelegramLoginServiceDependencies {
  return (
    service as unknown as {
      readonly dependencies: TelegramLoginServiceDependencies;
    }
  ).dependencies;
}

function getServiceDiagnosticObserver(
  service: TelegramLoginService,
): TelegramLoginDiagnosticObserver | undefined {
  return (
    service as unknown as {
      readonly diagnosticObserver?: TelegramLoginDiagnosticObserver;
    }
  ).diagnosticObserver;
}

function getControllerFeature(
  controller: TelegramLoginController,
): TelegramLoginFeature {
  return (
    controller as unknown as {
      readonly feature: TelegramLoginFeature;
    }
  ).feature;
}

function expectProviderNotRegistered(
  moduleRef: TestingModule,
  token: string | symbol | Type<unknown>,
): void {
  expect(() => moduleRef.get(token, { strict: false })).toThrow();
}

describe('AuthModule Telegram login wiring', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('compiles with database and Telegram workflow disabled without touching the pool', async () => {
    const getPool = jest.spyOn(PostgresService.prototype, 'getPool');
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const moduleRef = await compileAuthModule({
      DATABASE_ENABLED: false,
      DATABASE_URL: '',
      TELEGRAM_AUTH_ENABLED: false,
    });

    expect(getFeature(moduleRef)).toEqual({ enabled: false });
    expect(
      getControllerFeature(moduleRef.get(TelegramLoginController)),
    ).toBe(getFeature(moduleRef));
    expect(moduleRef.get(PostgresService).isEnabled()).toBe(false);
    for (const token of [
      TelegramLoginService,
      TelegramInitDataVerifier,
      TelegramLookupDigestCandidatesAdapter,
      DeterministicTelegramLoginWorkflowBindingsAdapter,
      NodeSessionCredentialIssuer,
    ]) {
      expectProviderNotRegistered(moduleRef, token);
    }
    expect(getPool).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    await moduleRef.close();
    expect(getPool).not.toHaveBeenCalled();
  });

  it('resolves the enabled feature with production singleton dependencies without connecting to PostgreSQL', async () => {
    const getPool = jest.spyOn(PostgresService.prototype, 'getPool');
    const moduleRef = await compileAuthModule(enabledConfiguration());
    const feature = getFeature(moduleRef);
    expect(feature.enabled).toBe(true);
    if (!feature.enabled) {
      throw new Error('Expected enabled Telegram login feature');
    }

    expect(feature.service).toBeInstanceOf(TelegramLoginService);
    expect(
      getControllerFeature(moduleRef.get(TelegramLoginController)),
    ).toBe(feature);
    expectProviderNotRegistered(moduleRef, TelegramLoginService);
    const dependencies = getServiceDependencies(feature.service);
    expect(dependencies.verifier).toBeInstanceOf(TelegramInitDataVerifier);
    expect(dependencies.lookupDigests).toBeInstanceOf(
      TelegramLookupDigestCandidatesAdapter,
    );
    expect(dependencies.credentialIssuer).toBeInstanceOf(
      NodeSessionCredentialIssuer,
    );
    expect(dependencies.workflowBindings).toBeInstanceOf(
      DeterministicTelegramLoginWorkflowBindingsAdapter,
    );
    expect(dependencies.transactions).toBe(
      moduleRef.get(PostgresTransactionExecutorAdapter),
    );
    expect(dependencies.pendingOperations).toBe(
      moduleRef.get(PostgresTelegramAuthenticationOperationRepository),
    );
    expect(dependencies.externalIdentities).toBe(
      moduleRef.get(PostgresExternalIdentityResolutionRepository),
    );
    expect(dependencies.accounts).toBe(
      moduleRef.get(PostgresAccountStatusReader),
    );
    expect(dependencies.playerAccounts).toBe(
      moduleRef.get(PostgresPlayerAccountProvisioningRepository),
    );
    expect(dependencies.terminalOperations).toBe(
      moduleRef.get(PostgresAuthenticationOperationTerminalRepository),
    );
    expect(dependencies.initialSessions).toBe(
      moduleRef.get(PostgresInitialSessionRepository),
    );
    expect(moduleRef.get(PostgresSecurityAuditRepository)).toBeInstanceOf(
      PostgresSecurityAuditRepository,
    );
    expect(moduleRef.get(PostgresTransactionRunner)).toBeInstanceOf(
      PostgresTransactionRunner,
    );
    expect(getPool).not.toHaveBeenCalled();
    await moduleRef.close();
    expect(getPool).not.toHaveBeenCalled();
  });

  it('wires approved versions and TTL values', async () => {
    const moduleRef = await compileAuthModule(enabledConfiguration());
    const proof = verifiedProof();
    const feature = getFeature(moduleRef);
    if (!feature.enabled) {
      throw new Error('Expected enabled Telegram login feature');
    }
    const dependencies = getServiceDependencies(feature.service);
    const lookup = await dependencies.lookupDigests.computeCandidates(proof);
    const bindings = dependencies.workflowBindings.create(
      'stable-request-key',
      proof,
      NOW,
    );

    expect(lookup.primary).toMatchObject({
      digestVersion: 1,
      pepperVersion: 1,
    });
    expect(bindings.timestamps.operationExpiresAt).toBe(
      NOW + TELEGRAM_AUTH_OPERATION_TTL_SECONDS,
    );
    expect(bindings.timestamps.sessionExpiresAt).toBe(
      NOW + TELEGRAM_SESSION_TTL_SECONDS,
    );
    await moduleRef.close();
  });

  it('logs a fixed reason-only diagnostic through the wired verifier', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const moduleRef = await compileAuthModule(enabledConfiguration());
    warn.mockClear();
    const feature = getFeature(moduleRef);
    if (!feature.enabled) {
      throw new Error('Expected enabled Telegram login feature');
    }
    const verifier = getServiceDependencies(feature.service).verifier;
    const rawMarker = 'SYNTHETIC_RAW_INIT_DATA_MARKER';
    const userIdMarker = '987654321';
    const rawAuthDateMarker = '1800000000';
    const rawInitData = [
      `auth_date=${rawAuthDateMarker}`,
      `user=${encodeURIComponent(
        JSON.stringify({
          id: Number(userIdMarker),
          first_name: rawMarker,
        }),
      )}`,
      `hash=${'0'.repeat(64)}`,
    ].join('&');

    expect(verifier.verifyProof(rawInitData)).toEqual({
      status: 'invalid',
      reason: 'invalid_proof',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Telegram initData verification rejected reason=hash_mismatch',
    );
    const logged = inspect(warn.mock.calls);
    for (const marker of [
      rawInitData,
      rawMarker,
      userIdMarker,
      rawAuthDateMarker,
      '0'.repeat(64),
      TEST_BOT_TOKEN,
      'requestKey',
      'credential',
      'proofFingerprint',
      'lookupDigest',
      'cause',
    ]) {
      expect(logged.includes(marker)).toBe(false);
    }
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(warn.mock.calls[0]?.[0]).not.toBeInstanceOf(Error);

    await moduleRef.close();
  });

  it('logs an expired diagnostic with only its safe bucket', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const moduleRef = await compileAuthModule(enabledConfiguration());
    warn.mockClear();
    const feature = getFeature(moduleRef);
    if (!feature.enabled) {
      throw new Error('Expected enabled Telegram login feature');
    }
    const verifier = getServiceDependencies(feature.service).verifier;
    const userMarker = 'SYNTHETIC_EXPIRED_USER_MARKER';
    const rawAuthDate = '1';
    const rawInitData = signedInitData([
      ['auth_date', rawAuthDate],
      [
        'user',
        JSON.stringify({
          id: 123456789,
          first_name: userMarker,
        }),
      ],
    ]);

    expect(verifier.verifyProof(rawInitData)).toMatchObject({
      status: 'expired',
      reason: 'expired_proof',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Telegram initData verification rejected reason=auth_date_expired bucket=expired_by_over_3600s',
    );
    const logged = inspect(warn.mock.calls);
    for (const marker of [
      rawInitData,
      userMarker,
      rawAuthDate,
      '123456789',
      TEST_BOT_TOKEN,
    ]) {
      expect(logged.includes(marker)).toBe(false);
    }
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(warn.mock.calls[0]?.[0]).not.toBeInstanceOf(Error);

    await moduleRef.close();
  });

  it('logs only the allowlisted invalid optional field name', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const moduleRef = await compileAuthModule(enabledConfiguration());
    warn.mockClear();
    const feature = getFeature(moduleRef);
    if (!feature.enabled) {
      throw new Error('Expected enabled Telegram login feature');
    }
    const verifier = getServiceDependencies(feature.service).verifier;
    const valueMarker = 'SYNTHETIC_PRIVATE_USERNAME_VALUE';
    const rawAuthDate = '1700000000';
    const rawInitData = signedInitData([
      ['auth_date', rawAuthDate],
      [
        'user',
        JSON.stringify({
          id: 987654321,
          first_name: 'Optional field logger',
          username: { privateMarker: valueMarker },
        }),
      ],
    ]);

    expect(verifier.verifyProof(rawInitData)).toEqual({
      status: 'invalid',
      reason: 'invalid_proof',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Telegram initData verification rejected reason=optional_field_invalid field=username',
    );
    const logged = inspect(warn.mock.calls);
    for (const marker of [
      rawInitData,
      valueMarker,
      '987654321',
      rawAuthDate,
      TEST_BOT_TOKEN,
    ]) {
      expect(logged.includes(marker)).toBe(false);
    }
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(warn.mock.calls[0]?.[0]).not.toBeInstanceOf(Error);

    await moduleRef.close();
  });

  it('wires Telegram login stages to a fixed Logger message', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const moduleRef = await compileAuthModule(enabledConfiguration());
    warn.mockClear();
    const feature = getFeature(moduleRef);
    if (!feature.enabled) {
      throw new Error('Expected enabled Telegram login feature');
    }
    const observer = getServiceDiagnosticObserver(feature.service);
    expect(observer).toBeDefined();
    const sensitiveMarker = 'SYNTHETIC_WORKFLOW_SECRET_MARKER';

    observer?.(
      Object.freeze({
        stage: 'initial_session_persistence',
        rawInitData: sensitiveMarker,
        requestKey: sensitiveMarker,
        credential: sensitiveMarker,
        error: new Error(sensitiveMarker),
      }) as unknown as Parameters<TelegramLoginDiagnosticObserver>[0],
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Telegram login failed stage=initial_session_persistence',
    );
    const logged = inspect(warn.mock.calls);
    expect(logged).not.toContain(sensitiveMarker);
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(warn.mock.calls[0]?.[0]).not.toBeInstanceOf(Error);

    await moduleRef.close();
  });

  it('keeps the public service result unchanged when the workflow Logger throws', async () => {
    const sensitiveMarker = 'SYNTHETIC_WORKFLOW_LOGGER_FAILURE';
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {
        throw new Error(sensitiveMarker);
      });
    const getPool = jest.spyOn(PostgresService.prototype, 'getPool');
    const moduleRef = await compileAuthModule(enabledConfiguration());
    const feature = getFeature(moduleRef);
    if (!feature.enabled) {
      throw new Error('Expected enabled Telegram login feature');
    }
    const dependencies = getServiceDependencies(feature.service);
    jest.spyOn(dependencies.verifier, 'verifyProof').mockReturnValue({
      status: 'verified',
      proof: verifiedProof(),
    });
    jest
      .spyOn(dependencies.lookupDigests, 'computeCandidates')
      .mockRejectedValue(new Error(sensitiveMarker));
    warn.mockClear();

    await expect(
      feature.service.authenticateWithTelegram({
        rawInitData: sensitiveMarker,
        requestKey: sensitiveMarker,
        now: NOW,
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Telegram login failed stage=proof_preparation',
    );
    expect(inspect(warn.mock.calls)).not.toContain(sensitiveMarker);
    expect(getPool).not.toHaveBeenCalled();

    await moduleRef.close();
    expect(getPool).not.toHaveBeenCalled();
  });

  it('keeps verifier outcomes unchanged when the Logger throws', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {
        throw new Error('SYNTHETIC_LOGGER_FAILURE');
      });
    const moduleRef = await compileAuthModule(enabledConfiguration());
    warn.mockClear();
    const feature = getFeature(moduleRef);
    if (!feature.enabled) {
      throw new Error('Expected enabled Telegram login feature');
    }
    const verifier = getServiceDependencies(feature.service).verifier;
    const rawInitData = signedInitData([
      ['auth_date', '1700000000'],
      [
        'user',
        JSON.stringify({
          id: 987654321,
          first_name: 'Logger failure',
          language_code: {
            privateMarker: 'SYNTHETIC_LOGGER_FIELD_VALUE',
          },
        }),
      ],
    ]);

    expect(verifier.verifyProof(rawInitData)).toEqual({
      status: 'invalid',
      reason: 'invalid_proof',
    });
    expect(warn).toHaveBeenCalledTimes(1);

    await moduleRef.close();
  });

  it('produces identical bindings across independent Nest containers', async () => {
    const firstModule = await compileAuthModule(enabledConfiguration());
    const secondModule = await compileAuthModule(enabledConfiguration());
    const proof = verifiedProof();

    const firstFeature = getFeature(firstModule);
    const secondFeature = getFeature(secondModule);
    if (!firstFeature.enabled || !secondFeature.enabled) {
      throw new Error('Expected enabled Telegram login features');
    }
    const first = getServiceDependencies(
      firstFeature.service,
    ).workflowBindings.create('stable-request-key', proof, NOW);
    const second = getServiceDependencies(
      secondFeature.service,
    ).workflowBindings.create('stable-request-key', proof, NOW);
    expect(second).toEqual(first);

    await firstModule.close();
    await secondModule.close();
  });

  it('keeps the feature disabled with PostgreSQL enabled and does not touch the pool', async () => {
    const getPool = jest.spyOn(PostgresService.prototype, 'getPool');
    const moduleRef = await compileAuthModule({
      DATABASE_ENABLED: true,
      DATABASE_URL: 'postgresql://test-only.invalid/prosto_padel',
      TELEGRAM_AUTH_ENABLED: false,
    });

    expect(getFeature(moduleRef)).toEqual({ enabled: false });
    expect(moduleRef.get(PostgresService).isEnabled()).toBe(true);
    expectProviderNotRegistered(moduleRef, TelegramLoginService);
    expect(getPool).not.toHaveBeenCalled();
    await moduleRef.close();
    expect(getPool).not.toHaveBeenCalled();
  });
});

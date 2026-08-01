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
import { PostgresMatchChatRepository } from '../database/postgres-match-chat.repository';
import { PostgresMatchInvitationRepository } from '../database/postgres-match-invitation.repository';
import { PostgresMatchLineupRepository } from '../database/postgres-match-lineup.repository';
import { PostgresMatchResultRepository } from '../database/postgres-match-result.repository';
import { PostgresMatchRepository } from '../database/postgres-match.repository';
import { PostgresMatchWaitlistRepository } from '../database/postgres-match-waitlist.repository';
import { PostgresPlayerAccountProvisioningRepository } from '../database/postgres-player-account-provisioning.repository';
import { PostgresPlayerProfileDetailsRepository } from '../database/postgres-player-profile-details.repository';
import { PostgresPlayerProfileReader } from '../database/postgres-player-profile-reader';
import { PostgresPlayerProfileWriter } from '../database/postgres-player-profile-writer';
import { PostgresPublicPlayerProfileSearchRepository } from '../database/postgres-public-player-profile-search.repository';
import { PostgresSecurityAuditRepository } from '../database/postgres-security-audit.repository';
import { PostgresSessionAuthenticationRepository } from '../database/postgres-session-authentication.repository';
import { PostgresSessionCredentialLifecycleRepository } from '../database/postgres-session-credential-lifecycle.repository';
import { PostgresService } from '../database/postgres.service';
import { PostgresTelegramAuthenticationOperationRepository } from '../database/postgres-telegram-authentication-operation.repository';
import { PostgresTransactionRunner } from '../database/postgres-transaction';
import { PostgresTransactionExecutorAdapter } from '../database/postgres-transaction-executor.adapter';
import { ContentModerationController } from '../common/content-moderation.controller';
import { MatchApiService } from '../matches/match-api.service';
import { MatchChatController } from '../matches/match-chat.controller';
import { MatchChatService } from '../matches/match-chat.service';
import { MATCH_COURT_CATALOG } from '../matches/match-court-catalog';
import { MatchController } from '../matches/match.controller';
import { MatchInvitationController } from '../matches/match-invitation.controller';
import { MatchInvitationService } from '../matches/match-invitation.service';
import { MatchLineupController } from '../matches/match-lineup.controller';
import { MatchLineupService } from '../matches/match-lineup.service';
import { MatchResultController } from '../matches/match-result.controller';
import { MatchResultService } from '../matches/match-result.service';
import { MatchWaitlistController } from '../matches/match-waitlist.controller';
import { MatchWaitlistService } from '../matches/match-waitlist.service';
import {
  AuthenticationProofFingerprint,
  VerifiedTelegramProof,
  unixEpochSeconds,
} from './auth.types';
import { AuthModule } from './auth.module';
import { NodeSessionCredentialIssuer } from './session-credential-issuer.adapter';
import { PlayerProfileController } from './player-profile.controller';
import { PlayerProfileService } from './player-profile.service';
import { PublicPlayerProfileController } from './public-player-profile.controller';
import { PublicPlayerProfileService } from './public-player-profile.service';
import { SessionAuthenticationController } from './session-authentication.controller';
import {
  SESSION_AUTHENTICATION_CLOCK,
  SessionBearerGuard,
} from './session-authentication.guard';
import { SessionAuthenticationService } from './session-authentication.service';
import { SessionLifecycleController } from './session-lifecycle.controller';
import { SessionLifecycleService } from './session-lifecycle.service';
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

function getSessionLifecycleControllerService(
  controller: SessionLifecycleController,
): SessionLifecycleService {
  return (
    controller as unknown as {
      readonly service: SessionLifecycleService;
    }
  ).service;
}

function getSessionBearerGuardService(
  guard: SessionBearerGuard,
): SessionAuthenticationService {
  return (
    guard as unknown as {
      readonly service: SessionAuthenticationService;
    }
  ).service;
}

function getPlayerProfileControllerService(
  controller: PlayerProfileController,
): PlayerProfileService {
  return (
    controller as unknown as {
      readonly service: PlayerProfileService;
    }
  ).service;
}

function getPublicPlayerProfileControllerService(
  controller: PublicPlayerProfileController,
): PublicPlayerProfileService {
  return (
    controller as unknown as {
      readonly service: PublicPlayerProfileService;
    }
  ).service;
}

function getMatchControllerService(
  controller: MatchController,
): MatchApiService {
  return (
    controller as unknown as {
      readonly service: MatchApiService;
    }
  ).service;
}

function getMatchInvitationControllerService(
  controller: MatchInvitationController,
): MatchInvitationService {
  return (
    controller as unknown as {
      readonly service: MatchInvitationService;
    }
  ).service;
}

function getMatchChatControllerService(
  controller: MatchChatController,
): MatchChatService {
  return (
    controller as unknown as {
      readonly service: MatchChatService;
    }
  ).service;
}

function getMatchWaitlistControllerService(
  controller: MatchWaitlistController,
): MatchWaitlistService {
  return (
    controller as unknown as {
      readonly service: MatchWaitlistService;
    }
  ).service;
}

function getMatchLineupControllerService(
  controller: MatchLineupController,
): MatchLineupService {
  return (
    controller as unknown as {
      readonly service: MatchLineupService;
    }
  ).service;
}

function getMatchResultControllerService(
  controller: MatchResultController,
): MatchResultService {
  return (
    controller as unknown as {
      readonly service: MatchResultService;
    }
  ).service;
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
    const sessionLifecycle = moduleRef.get(SessionLifecycleService);
    expect(sessionLifecycle.dependencies.transactions).toBe(
      moduleRef.get(PostgresTransactionExecutorAdapter),
    );
    expect(sessionLifecycle.dependencies.sessions).toBe(
      moduleRef.get(PostgresSessionCredentialLifecycleRepository),
    );
    expect(sessionLifecycle.dependencies.credentialIssuer).toBeInstanceOf(
      NodeSessionCredentialIssuer,
    );
    expect(
      getSessionLifecycleControllerService(
        moduleRef.get(SessionLifecycleController),
      ),
    ).toBe(sessionLifecycle);
    const sessionAuthentication = moduleRef.get(
      SessionAuthenticationService,
    );
    expect(sessionAuthentication.dependencies.transactions).toBe(
      moduleRef.get(PostgresTransactionExecutorAdapter),
    );
    expect(sessionAuthentication.dependencies.sessions).toBe(
      moduleRef.get(PostgresSessionAuthenticationRepository),
    );
    expect(
      getSessionBearerGuardService(moduleRef.get(SessionBearerGuard)),
    ).toBe(sessionAuthentication);
    expect(moduleRef.get(SessionAuthenticationController)).toBeInstanceOf(
      SessionAuthenticationController,
    );
    const playerProfile = moduleRef.get(PlayerProfileService);
    expect(playerProfile.dependencies.transactions).toBe(
      moduleRef.get(PostgresTransactionExecutorAdapter),
    );
    expect(playerProfile.dependencies.profiles).toBe(
      moduleRef.get(PostgresPlayerProfileReader),
    );
    expect(playerProfile.dependencies.profileWriter).toBe(
      moduleRef.get(PostgresPlayerProfileWriter),
    );
    expect(playerProfile.dependencies.clock).toBe(
      moduleRef.get(SESSION_AUTHENTICATION_CLOCK),
    );
    expect(
      getPlayerProfileControllerService(
        moduleRef.get(PlayerProfileController),
      ),
    ).toBe(playerProfile);
    const publicPlayerProfile = moduleRef.get(
      PublicPlayerProfileService,
    );
    expect(publicPlayerProfile.dependencies.transactions).toBe(
      moduleRef.get(PostgresTransactionExecutorAdapter),
    );
    expect(publicPlayerProfile.dependencies.profiles).toBe(
      moduleRef.get(PostgresPublicPlayerProfileSearchRepository),
    );
    expect(
      getPublicPlayerProfileControllerService(
        moduleRef.get(PublicPlayerProfileController),
      ),
    ).toBe(publicPlayerProfile);
    const matchApi = moduleRef.get(MatchApiService);
    const matchRepository = moduleRef.get(PostgresMatchRepository);
    const matchWaitlist = moduleRef.get(MatchWaitlistService);
    const matchLineup = moduleRef.get(MatchLineupService);
    const matchResult = moduleRef.get(MatchResultService);
    expect(matchResult.dependencies.transactions).toBe(
      moduleRef.get(PostgresTransactionExecutorAdapter),
    );
    expect(matchResult.dependencies.results).toBe(
      moduleRef.get(PostgresMatchResultRepository),
    );
    expect(matchResult.dependencies.clock).toBe(
      moduleRef.get(SESSION_AUTHENTICATION_CLOCK),
    );
    expect(
      getMatchResultControllerService(
        moduleRef.get(MatchResultController),
      ),
    ).toBe(matchResult);
    expect(matchLineup.dependencies.transactions).toBe(
      moduleRef.get(PostgresTransactionExecutorAdapter),
    );
    expect(matchLineup.dependencies.lineups).toBe(
      moduleRef.get(PostgresMatchLineupRepository),
    );
    expect(matchLineup.dependencies.publicProfiles).toBe(
      moduleRef.get(PostgresPublicPlayerProfileSearchRepository),
    );
    expect(matchLineup.dependencies.clock).toBe(
      moduleRef.get(SESSION_AUTHENTICATION_CLOCK),
    );
    expect(
      getMatchLineupControllerService(
        moduleRef.get(MatchLineupController),
      ),
    ).toBe(matchLineup);
    expect(matchWaitlist.dependencies.transactions).toBe(
      moduleRef.get(PostgresTransactionExecutorAdapter),
    );
    expect(matchWaitlist.dependencies.waitlist).toBe(
      moduleRef.get(PostgresMatchWaitlistRepository),
    );
    expect(matchWaitlist.dependencies.matches).toBe(matchRepository);
    expect(matchWaitlist.dependencies.publicProfiles).toBe(
      moduleRef.get(PostgresPublicPlayerProfileSearchRepository),
    );
    expect(matchWaitlist.dependencies.clock).toBe(
      moduleRef.get(SESSION_AUTHENTICATION_CLOCK),
    );
    expect(
      getMatchWaitlistControllerService(
        moduleRef.get(MatchWaitlistController),
      ),
    ).toBe(matchWaitlist);
    expect(matchApi.dependencies.transactions).toBe(
      moduleRef.get(PostgresTransactionExecutorAdapter),
    );
      expect(matchApi.dependencies.matches).toBe(matchRepository);
      expect(matchApi.dependencies.publicProfiles).toBe(
        moduleRef.get(PostgresPublicPlayerProfileSearchRepository),
      );
    expect(matchApi.dependencies.waitlist).toBe(matchWaitlist);
    expect(matchApi.dependencies.lineups).toBe(matchLineup);
    expect(matchRepository.profiles).toBe(
      moduleRef.get(PostgresPlayerProfileReader),
    );
    expect(matchRepository.courts).toBe(
      moduleRef.get(MATCH_COURT_CATALOG),
    );
    expect(matchApi.dependencies.clock).toBe(
      moduleRef.get(SESSION_AUTHENTICATION_CLOCK),
    );
    expect(
      getMatchControllerService(moduleRef.get(MatchController)),
    ).toBe(matchApi);
    const matchInvitations = moduleRef.get(MatchInvitationService);
    expect(matchInvitations.dependencies.transactions).toBe(
      moduleRef.get(PostgresTransactionExecutorAdapter),
    );
    expect(matchInvitations.dependencies.invitations).toBe(
      moduleRef.get(PostgresMatchInvitationRepository),
    );
    expect(matchInvitations.dependencies.publicProfiles).toBe(
      moduleRef.get(PostgresPublicPlayerProfileSearchRepository),
    );
    expect(matchInvitations.dependencies.waitlist).toBe(matchWaitlist);
    expect(matchInvitations.dependencies.clock).toBe(
      moduleRef.get(SESSION_AUTHENTICATION_CLOCK),
    );
    expect(
      getMatchInvitationControllerService(
        moduleRef.get(MatchInvitationController),
      ),
    ).toBe(matchInvitations);
    expect(
      moduleRef.get(PostgresMatchInvitationRepository).matches,
    ).toBe(matchRepository);
    const matchChat = moduleRef.get(MatchChatService);
    expect(matchChat.dependencies.transactions).toBe(
      moduleRef.get(PostgresTransactionExecutorAdapter),
    );
    expect(matchChat.dependencies.chat).toBe(
      moduleRef.get(PostgresMatchChatRepository),
    );
    expect(matchChat.dependencies.clock).toBe(
      moduleRef.get(SESSION_AUTHENTICATION_CLOCK),
    );
    expect(
      getMatchChatControllerService(moduleRef.get(MatchChatController)),
    ).toBe(matchChat);
    expect(moduleRef.get(ContentModerationController)).toBeInstanceOf(
      ContentModerationController,
    );
    expect(() => moduleRef.get(SESSION_AUTHENTICATION_CLOCK)).not.toThrow();
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
    expect(dependencies.profileDetails).toBe(
      moduleRef.get(PostgresPlayerProfileDetailsRepository),
    );
    expect(moduleRef.get(PostgresPlayerProfileReader)).toBeInstanceOf(
      PostgresPlayerProfileReader,
    );
    expect(moduleRef.get(PostgresPlayerProfileWriter)).toBeInstanceOf(
      PostgresPlayerProfileWriter,
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

    expect(verifier.verifyLoginProof(rawInitData)).toEqual({
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

    expect(verifier.verifyLoginProof(rawInitData)).toMatchObject({
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

    expect(verifier.verifyLoginProof(rawInitData)).toEqual({
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

  it('wires Telegram login checkpoints to a fixed Logger message', async () => {
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
    const sensitiveMarker = 'SYNTHETIC_TERMINAL_CHECKPOINT_SECRET';

    observer?.(
      Object.freeze({
        checkpoint: 'terminal_result_validation',
        rawInitData: sensitiveMarker,
        operationId: sensitiveMarker,
        sqlState: sensitiveMarker,
        constraint: sensitiveMarker,
        error: new Error(sensitiveMarker),
      }) as unknown as Parameters<TelegramLoginDiagnosticObserver>[0],
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Telegram login failed checkpoint=terminal_result_validation',
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
    jest
      .spyOn(dependencies.verifier, 'verifyLoginProof')
      .mockReturnValue({
        status: 'verified',
        proof: verifiedProof(),
        profile: Object.freeze({ firstName: 'Synthetic' }),
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

    expect(verifier.verifyLoginProof(rawInitData)).toEqual({
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

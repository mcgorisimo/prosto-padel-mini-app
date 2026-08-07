import {
  normalizeYclientsHttpsBaseUrl,
  YCLIENTS_API_DEFAULT_BASE_URL,
  YclientsApiConfiguration,
} from '../../config/yclients-api.config';
import { YclientsAdminReadClient } from './yclients-admin-read.client';
import { YclientsApiClient } from './yclients-api.client';
import { YclientsAvailabilityService } from './yclients-availability.service';
import {
  YclientsAdminWriteClient,
  YclientsControlledFullRecordReader,
} from './yclients-controlled-admin.client';
import {
  YclientsControlledEvidenceSink,
  YclientsControlledLifecycle,
  YclientsControlledLifecycleClock,
  YclientsControlledRootOnlyBindingSink,
} from './yclients-controlled-lifecycle';
import {
  YclientsControlledIdentityVerifier,
  YclientsControlledPersistentApprovalGate,
  YclientsControlledTestRunner,
} from './yclients-controlled-runner';
import {
  YclientsConservativeRequestLimiter,
  YclientsRequestLimiterClock,
} from './yclients-request-limiter';

export type YclientsControlledExecutableClock =
  YclientsControlledLifecycleClock & YclientsRequestLimiterClock;

export type YclientsControlledExecutableConfiguration = Readonly<{
  baseUrl: string;
  companyId: number;
  partnerToken: string;
  userToken: string;
  requestTimeoutMilliseconds: number;
  fetch: typeof globalThis.fetch;
  clock: YclientsControlledExecutableClock;
  evidence: YclientsControlledEvidenceSink;
  bindings: YclientsControlledRootOnlyBindingSink;
  identity: YclientsControlledIdentityVerifier;
  approval: YclientsControlledPersistentApprovalGate;
}>;

/**
 * Concrete one-shot assembly for a root-only controlled harness. It has no
 * Nest module, environment loader, CLI registration or application import.
 */
export function createYclientsControlledExecutableRunner(
  configuration: YclientsControlledExecutableConfiguration,
): YclientsControlledTestRunner {
  const baseUrl = normalizeYclientsHttpsBaseUrl(configuration.baseUrl);
  if (baseUrl !== YCLIENTS_API_DEFAULT_BASE_URL) {
    throw new TypeError('Invalid controlled YCLIENTS endpoint');
  }
  const runtime: YclientsApiConfiguration = Object.freeze({
    enabled: true,
    bookingWriteEnabled: true,
    baseUrl,
    companyId: configuration.companyId,
    partnerToken: configuration.partnerToken,
    userToken: configuration.userToken,
  });
  const limiter = new YclientsConservativeRequestLimiter({
    clock: configuration.clock,
    minimumIntervalMilliseconds: 1_000,
    maximumRequestsPerMinute: 60,
  });
  const api = new YclientsApiClient({
    runtime,
    requestTimeoutMilliseconds: configuration.requestTimeoutMilliseconds,
    fetch: configuration.fetch,
  });
  const availability = new YclientsAvailabilityService(api);
  const adminRead = new YclientsAdminReadClient({
    runtime,
    requestTimeoutMilliseconds: configuration.requestTimeoutMilliseconds,
    fetch: configuration.fetch,
    limiter,
  });
  const controlledConfiguration = Object.freeze({
    enabled: true,
    baseUrl,
    companyId: configuration.companyId,
    partnerToken: configuration.partnerToken,
    userToken: configuration.userToken,
    requestTimeoutMilliseconds: configuration.requestTimeoutMilliseconds,
    fetch: configuration.fetch,
    limiter,
  });
  const fullReader = new YclientsControlledFullRecordReader(
    controlledConfiguration,
  );
  const writer = new YclientsAdminWriteClient(controlledConfiguration);

  return new YclientsControlledTestRunner({
    companyId: configuration.companyId,
    identity: configuration.identity,
    approval: configuration.approval,
    lifecycle: {
      create: () =>
        new YclientsControlledLifecycle({
          availability,
          create: api,
          fullReader,
          safeReader: adminRead,
          writer,
          clock: configuration.clock,
          evidence: configuration.evidence,
          bindings: configuration.bindings,
        }),
    },
  });
}

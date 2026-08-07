import {
  normalizeYclientsHttpsBaseUrl,
  YCLIENTS_API_DEFAULT_BASE_URL,
  YclientsApiConfiguration,
} from '../../config/yclients-api.config';
import { YclientsAdminReadClient } from './yclients-admin-read.client';
import {
  YclientsAdminWriteClient,
  YclientsControlledCleanupRecordReader,
} from './yclients-controlled-admin.client';
import {
  YclientsControlledCleanupEvidenceSink,
  YclientsControlledCleanupLifecycle,
} from './yclients-controlled-cleanup-lifecycle';
import { YclientsControlledCleanupRunner } from './yclients-controlled-cleanup-runner';
import type {
  YclientsControlledIdentityVerifier,
  YclientsControlledPersistentApprovalGate,
} from './yclients-controlled-runner';
import {
  YclientsConservativeRequestLimiter,
  YclientsRequestLimiterClock,
} from './yclients-request-limiter';

export type YclientsControlledCleanupExecutableClock =
  YclientsRequestLimiterClock;

export type YclientsControlledCleanupExecutableConfiguration = Readonly<{
  baseUrl: string;
  companyId: number;
  partnerToken: string;
  userToken: string;
  requestTimeoutMilliseconds: number;
  fetch: typeof globalThis.fetch;
  clock: YclientsControlledCleanupExecutableClock;
  evidence: YclientsControlledCleanupEvidenceSink;
  identity: YclientsControlledIdentityVerifier;
  approval: YclientsControlledPersistentApprovalGate;
  sourceBindingVerified: true;
}>;

/**
 * Isolated cleanup assembly. It is intentionally not imported by a Nest
 * module, controller or application entrypoint.
 */
export function createYclientsControlledCleanupExecutableRunner(
  configuration: YclientsControlledCleanupExecutableConfiguration,
): YclientsControlledCleanupRunner {
  if (
    configuration.approval?.persistence !== 'cross_process' ||
    configuration.sourceBindingVerified !== true
  ) {
    throw new TypeError('Invalid controlled cleanup persistent gates');
  }
  const baseUrl = normalizeYclientsHttpsBaseUrl(configuration.baseUrl);
  if (baseUrl !== YCLIENTS_API_DEFAULT_BASE_URL) {
    throw new TypeError('Invalid controlled cleanup YCLIENTS endpoint');
  }
  const runtime: YclientsApiConfiguration = Object.freeze({
    enabled: true,
    bookingWriteEnabled: false,
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
  const safeReader = new YclientsAdminReadClient({
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
  const exactReader = new YclientsControlledCleanupRecordReader(
    controlledConfiguration,
  );
  const writer = new YclientsAdminWriteClient(controlledConfiguration);

  return new YclientsControlledCleanupRunner({
    companyId: configuration.companyId,
    identity: configuration.identity,
    approval: configuration.approval,
    lifecycle: {
      create: () =>
        new YclientsControlledCleanupLifecycle({
          exactReader,
          safeReader,
          writer,
          evidence: configuration.evidence,
          clock: configuration.clock,
        }),
    },
  });
}

import { createHash } from 'node:crypto';
import type { YclientsCreateBookingCommand } from './yclients-api.client';
import {
  isValidYclientsControlledLifecycleInput,
  YclientsControlledLifecycle,
  YclientsControlledLifecycleInput,
  YclientsControlledLifecycleResult,
} from './yclients-controlled-lifecycle';

const PLAN_VERSION = 1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/u;

export type YclientsControlledRunnerPlan = Readonly<{
  planVersion: typeof PLAN_VERSION;
  planId: string;
  companyId: number;
  /**
   * Opaque version of a root-only identity configuration. It must not contain
   * PII or an ordinary PII digest. The verifier binds it to the client snapshot.
   */
  identityBinding: string;
  lifecycle: YclientsControlledLifecycleInput;
}>;

export type YclientsControlledRunnerExecution =
  | Readonly<{ mode?: 'dry_run' }>
  | Readonly<{ mode: 'execute'; planDigest: string }>;

export type YclientsControlledApprovalOutcome =
  | 'approved'
  | 'missing'
  | 'mismatch'
  | 'consumed';

export interface YclientsControlledOneTimeApprovalGate {
  /** Must atomically consume an approval before any provider lifecycle call. */
  consume(planDigest: string):
    | YclientsControlledApprovalOutcome
    | Promise<YclientsControlledApprovalOutcome>;
}

export interface YclientsControlledPersistentApprovalGate
  extends YclientsControlledOneTimeApprovalGate {
  readonly persistence: 'cross_process';
}

export interface YclientsControlledIdentityVerifier {
  verify(
    identityBinding: string,
    client: YclientsCreateBookingCommand['client'],
  ): boolean | Promise<boolean>;
}

export interface YclientsControlledLifecycleFactory {
  create(): Pick<YclientsControlledLifecycle, 'run'>;
}

export type YclientsControlledRunnerResult =
  | Readonly<{
      outcome: 'dry_run_ready';
      planDigest: string;
      providerRequestCount: 0;
    }>
  | Readonly<{
      outcome: 'blocked';
      reason:
        | 'invalid_plan'
        | 'invalid_execution'
        | 'identity_unverified'
        | 'digest_mismatch'
        | 'approval_missing'
        | 'approval_mismatch'
        | 'approval_consumed';
      providerRequestCount: 0;
      planDigest?: string;
    }>
  | Readonly<{
      outcome: 'executed';
      planDigest: string;
      lifecycle: YclientsControlledLifecycleResult;
    }>;

/** In-memory gate for exactly one process invocation; no approval is persisted. */
export class YclientsControlledSingleUseApproval
  implements YclientsControlledOneTimeApprovalGate
{
  private consumed = false;

  constructor(private readonly approvedPlanDigest?: string) {}

  consume(planDigest: string): YclientsControlledApprovalOutcome {
    if (this.consumed) return 'consumed';
    if (this.approvedPlanDigest === undefined) return 'missing';
    if (
      !SHA256_PATTERN.test(this.approvedPlanDigest) ||
      this.approvedPlanDigest !== planDigest
    ) {
      return 'mismatch';
    }
    this.consumed = true;
    return 'approved';
  }
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function snapshotPlan(
  value: YclientsControlledRunnerPlan,
): YclientsControlledRunnerPlan | undefined {
  if (
    value?.planVersion !== PLAN_VERSION ||
    typeof value.planId !== 'string' ||
    !SAFE_LABEL_PATTERN.test(value.planId) ||
    !positiveSafeInteger(value.companyId) ||
    typeof value.identityBinding !== 'string' ||
    !SAFE_LABEL_PATTERN.test(value.identityBinding)
  ) {
    return undefined;
  }
  const input = value.lifecycle;
  const lifecycle = Object.freeze({
    apiId: input?.apiId,
    client: Object.freeze({
      phone: input?.client?.phone,
      fullName: input?.client?.fullName,
      email: input?.client?.email,
    }),
    slotA: Object.freeze({ ...input?.slotA }),
    slotB: Object.freeze({ ...input?.slotB }),
    visibleListA: Object.freeze({ ...input?.visibleListA }),
    deletedListB: Object.freeze({ ...input?.deletedListB }),
  }) as YclientsControlledLifecycleInput;
  if (!isValidYclientsControlledLifecycleInput(lifecycle)) return undefined;
  return Object.freeze({
    planVersion: PLAN_VERSION,
    planId: value.planId,
    companyId: value.companyId,
    identityBinding: value.identityBinding,
    lifecycle,
  });
}

function planDigestProjection(plan: YclientsControlledRunnerPlan) {
  const input = plan.lifecycle;
  return {
    planVersion: plan.planVersion,
    planId: plan.planId,
    companyId: plan.companyId,
    identityBinding: plan.identityBinding,
    apiId: input.apiId,
    slotA: {
      alias: input.slotA.alias,
      serviceId: input.slotA.serviceId,
      resourceId: input.slotA.resourceId,
      datetime: input.slotA.datetime,
    },
    slotB: {
      alias: input.slotB.alias,
      serviceId: input.slotB.serviceId,
      resourceId: input.slotB.resourceId,
      datetime: input.slotB.datetime,
    },
    visibleListA: {
      page: input.visibleListA.page,
      count: input.visibleListA.count,
      resourceId: input.visibleListA.resourceId,
      dateFrom: input.visibleListA.dateFrom,
      dateTo: input.visibleListA.dateTo,
      withDeleted: input.visibleListA.withDeleted,
    },
    deletedListB: {
      page: input.deletedListB.page,
      count: input.deletedListB.count,
      resourceId: input.deletedListB.resourceId,
      dateFrom: input.deletedListB.dateFrom,
      dateTo: input.deletedListB.dateTo,
      withDeleted: input.deletedListB.withDeleted,
    },
    controls: {
      providerRequestBudget: 14,
      maximumInFlight: 1,
      minimumIntervalMilliseconds: 1_000,
      notifications: 'off',
      duplicateApiIdExperiment: false,
    },
  } as const;
}

export function createYclientsControlledPlanDigest(
  value: YclientsControlledRunnerPlan,
): string | undefined {
  const plan = snapshotPlan(value);
  if (plan === undefined) return undefined;
  return createHash('sha256')
    .update(JSON.stringify(planDigestProjection(plan)), 'utf8')
    .digest('hex');
}

export class YclientsControlledTestRunner {
  constructor(
    private readonly dependencies: Readonly<{
      companyId: number;
      identity: YclientsControlledIdentityVerifier;
      approval: YclientsControlledOneTimeApprovalGate;
      lifecycle: YclientsControlledLifecycleFactory;
    }>,
  ) {}

  async run(
    value: YclientsControlledRunnerPlan,
    execution: YclientsControlledRunnerExecution = Object.freeze({
      mode: 'dry_run',
    }),
  ): Promise<YclientsControlledRunnerResult> {
    const plan = snapshotPlan(value);
    if (
      plan === undefined ||
      !positiveSafeInteger(this.dependencies.companyId) ||
      plan.companyId !== this.dependencies.companyId
    ) {
      return Object.freeze({
        outcome: 'blocked' as const,
        reason: 'invalid_plan' as const,
        providerRequestCount: 0 as const,
      });
    }
    const planDigest = createYclientsControlledPlanDigest(plan);
    if (planDigest === undefined) {
      return Object.freeze({
        outcome: 'blocked' as const,
        reason: 'invalid_plan' as const,
        providerRequestCount: 0 as const,
      });
    }
    if (
      typeof execution !== 'object' ||
      execution === null ||
      Array.isArray(execution)
    ) {
      return Object.freeze({
        outcome: 'blocked' as const,
        reason: 'invalid_execution' as const,
        providerRequestCount: 0 as const,
        planDigest,
      });
    }
    const executionRecord = execution as unknown as Record<string, unknown>;
    const mode = executionRecord.mode;
    const executionKeys = Object.keys(executionRecord).sort();
    const validDryRun =
      (mode === undefined && executionKeys.length === 0) ||
      (mode === 'dry_run' &&
        executionKeys.length === 1 &&
        executionKeys[0] === 'mode');
    const validExecute =
      mode === 'execute' &&
      executionKeys.length === 2 &&
      executionKeys[0] === 'mode' &&
      executionKeys[1] === 'planDigest';
    if (!validDryRun && !validExecute) {
      return Object.freeze({
        outcome: 'blocked' as const,
        reason: 'invalid_execution' as const,
        providerRequestCount: 0 as const,
        planDigest,
      });
    }
    let identityVerified = false;
    try {
      identityVerified =
        (await this.dependencies.identity.verify(
          plan.identityBinding,
          plan.lifecycle.client,
        )) === true;
    } catch {
      identityVerified = false;
    }
    if (!identityVerified) {
      return Object.freeze({
        outcome: 'blocked' as const,
        reason: 'identity_unverified' as const,
        providerRequestCount: 0 as const,
        planDigest,
      });
    }
    if (validDryRun) {
      return Object.freeze({
        outcome: 'dry_run_ready' as const,
        planDigest,
        providerRequestCount: 0 as const,
      });
    }
    if (
      typeof executionRecord.planDigest !== 'string' ||
      !SHA256_PATTERN.test(executionRecord.planDigest) ||
      executionRecord.planDigest !== planDigest
    ) {
      return Object.freeze({
        outcome: 'blocked' as const,
        reason: 'digest_mismatch' as const,
        providerRequestCount: 0 as const,
        planDigest,
      });
    }
    let approval: YclientsControlledApprovalOutcome;
    try {
      approval = await this.dependencies.approval.consume(planDigest);
    } catch {
      approval = 'missing';
    }
    if (approval !== 'approved') {
      const reason =
        approval === 'mismatch'
          ? 'approval_mismatch'
          : approval === 'consumed'
            ? 'approval_consumed'
            : 'approval_missing';
      return Object.freeze({
        outcome: 'blocked' as const,
        reason,
        providerRequestCount: 0 as const,
        planDigest,
      });
    }
    const lifecycle = await this.dependencies.lifecycle
      .create()
      .run(plan.lifecycle);
    return Object.freeze({
      outcome: 'executed' as const,
      planDigest,
      lifecycle,
    });
  }
}

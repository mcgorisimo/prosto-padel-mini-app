import { createHash } from 'node:crypto';
import type {
  YclientsControlledCleanupInput,
  YclientsControlledCleanupLifecycle,
  YclientsControlledCleanupLifecycleResult,
} from './yclients-controlled-cleanup-lifecycle';
import { isValidYclientsControlledCleanupInput } from './yclients-controlled-cleanup-lifecycle';
import type {
  YclientsControlledApprovalOutcome,
  YclientsControlledIdentityVerifier,
  YclientsControlledOneTimeApprovalGate,
} from './yclients-controlled-runner';

const PLAN_VERSION = 1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/u;

export type YclientsControlledCleanupRunnerPlan = Readonly<{
  planVersion: typeof PLAN_VERSION;
  planId: string;
  companyId: number;
  identityBinding: string;
  lifecycle: YclientsControlledCleanupInput;
}>;

export type YclientsControlledCleanupRunnerExecution =
  | Readonly<{ mode?: 'dry_run' }>
  | Readonly<{ mode: 'execute'; planDigest: string }>;

export interface YclientsControlledCleanupLifecycleFactory {
  create(): Pick<YclientsControlledCleanupLifecycle, 'run'>;
}

export type YclientsControlledCleanupRunnerResult =
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
      lifecycle: YclientsControlledCleanupLifecycleResult;
    }>;

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function snapshotPlan(
  value: YclientsControlledCleanupRunnerPlan,
): YclientsControlledCleanupRunnerPlan | undefined {
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
    companyId: input?.companyId,
    recordId: input?.recordId,
    appointmentId: input?.appointmentId,
    apiId: input?.apiId,
    identityBinding: input?.identityBinding,
    client: Object.freeze({
      phone: input?.client?.phone,
      fullName: input?.client?.fullName,
      email: input?.client?.email,
    }),
    slotA: Object.freeze({ ...input?.slotA }),
    deletedListA: Object.freeze({ ...input?.deletedListA }),
  }) as YclientsControlledCleanupInput;
  if (
    !isValidYclientsControlledCleanupInput(lifecycle) ||
    lifecycle.companyId !== value.companyId ||
    lifecycle.identityBinding !== value.identityBinding
  ) {
    return undefined;
  }
  return Object.freeze({
    planVersion: PLAN_VERSION,
    planId: value.planId,
    companyId: value.companyId,
    identityBinding: value.identityBinding,
    lifecycle,
  });
}

function digestProjection(plan: YclientsControlledCleanupRunnerPlan) {
  const input = plan.lifecycle;
  return {
    planVersion: plan.planVersion,
    planId: plan.planId,
    companyId: plan.companyId,
    identityBinding: plan.identityBinding,
    recordId: input.recordId,
    appointmentId: input.appointmentId,
    apiId: input.apiId,
    slotA: {
      alias: input.slotA.alias,
      serviceId: input.slotA.serviceId,
      resourceId: input.slotA.resourceId,
      datetime: input.slotA.datetime,
    },
    deletedListA: {
      page: input.deletedListA.page,
      count: input.deletedListA.count,
      resourceId: input.deletedListA.resourceId,
      dateFrom: input.deletedListA.dateFrom,
      dateTo: input.deletedListA.dateTo,
      withDeleted: input.deletedListA.withDeleted,
    },
    controls: {
      providerRequestBudget: 4,
      maximumInFlight: 1,
      minimumIntervalMilliseconds: 1_000,
      maximumDeleteRequests: 1,
      repeatDelete: false,
      create: false,
      reschedule: false,
      releaseHoldRequiresExactAndListDeletedProof: true,
      administrativeNoChangeWindowRequired: true,
    },
  } as const;
}

export function createYclientsControlledCleanupPlanDigest(
  value: YclientsControlledCleanupRunnerPlan,
): string | undefined {
  const plan = snapshotPlan(value);
  if (plan === undefined) return undefined;
  return createHash('sha256')
    .update(JSON.stringify(digestProjection(plan)), 'utf8')
    .digest('hex');
}

export class YclientsControlledCleanupRunner {
  constructor(
    private readonly dependencies: Readonly<{
      companyId: number;
      identity: YclientsControlledIdentityVerifier;
      approval: YclientsControlledOneTimeApprovalGate;
      lifecycle: YclientsControlledCleanupLifecycleFactory;
    }>,
  ) {}

  async run(
    value: YclientsControlledCleanupRunnerPlan,
    execution: YclientsControlledCleanupRunnerExecution = Object.freeze({
      mode: 'dry_run',
    }),
  ): Promise<YclientsControlledCleanupRunnerResult> {
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
    const planDigest = createYclientsControlledCleanupPlanDigest(plan);
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
    const keys = Object.keys(executionRecord).sort();
    const mode = executionRecord.mode;
    const validDryRun =
      (mode === undefined && keys.length === 0) ||
      (mode === 'dry_run' && keys.length === 1 && keys[0] === 'mode');
    const validExecute =
      mode === 'execute' &&
      keys.length === 2 &&
      keys[0] === 'mode' &&
      keys[1] === 'planDigest';
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

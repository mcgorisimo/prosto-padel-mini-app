import type { YclientsControlledCleanupLifecycleResult } from './yclients-controlled-cleanup-lifecycle';
import {
  buildYclientsControlledCleanupOperationalPlan,
  YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
} from './yclients-controlled-cleanup-operational-plan';
import {
  createYclientsControlledCleanupPlanDigest,
  YclientsControlledCleanupRunner,
  YclientsControlledCleanupRunnerPlan,
} from './yclients-controlled-cleanup-runner';
import { YclientsControlledLoadedIdentity } from './yclients-controlled-operational-plan';
import { YclientsControlledSingleUseApproval } from './yclients-controlled-runner';

const PRIVATE_PHONE = '79990000000';
const PRIVATE_NAME = 'Disposable Test';
const PRIVATE_EMAIL = 'disposable@example.test';
const IDENTITY = new YclientsControlledLoadedIdentity(
  Object.freeze({
    phone: PRIVATE_PHONE,
    fullName: PRIVATE_NAME,
    email: PRIVATE_EMAIL,
  }),
);

function plan(): YclientsControlledCleanupRunnerPlan {
  return buildYclientsControlledCleanupOperationalPlan(IDENTITY);
}

function passed(): YclientsControlledCleanupLifecycleResult {
  return Object.freeze({
    outcome: 'cancelled_confirmed',
    reason: 'canonical_cancel_proof',
    requestCount: 4,
    holds: Object.freeze([]),
  });
}

function dependencies(approvedDigest?: string) {
  const verify = jest.fn().mockResolvedValue(true);
  const run = jest.fn().mockResolvedValue(passed());
  const approval = new YclientsControlledSingleUseApproval(approvedDigest);
  const consume = jest.spyOn(approval, 'consume');
  return {
    verify,
    run,
    approval,
    consume,
    value: {
      companyId: 2_079_564,
      identity: { verify },
      approval,
      lifecycle: { create: () => ({ run }) },
    },
  };
}

describe('YclientsControlledCleanupRunner', () => {
  it('is dry-run by default with zero approval or provider lifecycle calls', async () => {
    const setup = dependencies();
    const result = await new YclientsControlledCleanupRunner(setup.value).run(
      plan(),
    );

    expect(result).toEqual({
      outcome: 'dry_run_ready',
      planDigest: YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
      providerRequestCount: 0,
    });
    expect(setup.verify).toHaveBeenCalledTimes(1);
    expect(setup.verify).toHaveBeenCalledWith(
      plan().identityBinding,
      plan().lifecycle.client,
    );
    expect(setup.consume).not.toHaveBeenCalled();
    expect(setup.run).not.toHaveBeenCalled();
    const serialized = JSON.stringify(result);
    for (const forbidden of [PRIVATE_PHONE, PRIVATE_NAME, PRIVATE_EMAIL]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('uses a deterministic non-PII digest bound to record, effect, list and controls', () => {
    const original = createYclientsControlledCleanupPlanDigest(plan());
    const changedRecord = createYclientsControlledCleanupPlanDigest({
      ...plan(),
      lifecycle: { ...plan().lifecycle, recordId: 1_891_713_982 },
    });
    const changedList = createYclientsControlledCleanupPlanDigest({
      ...plan(),
      lifecycle: {
        ...plan().lifecycle,
        deletedListA: { ...plan().lifecycle.deletedListA, count: 49 },
      },
    });

    expect(original).toBe(YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST);
    expect(changedRecord).not.toBe(original);
    expect(changedList).not.toBe(original);
    expect(original).not.toContain(PRIVATE_PHONE);
    expect(original).not.toContain(PRIVATE_NAME);
    expect(original).not.toContain(PRIVATE_EMAIL);
  });

  it.each([
    { mode: 'unexpected', planDigest: YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST },
    { mode: null, planDigest: YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST },
    {
      mode: 'execute',
      planDigest: YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
      extra: true,
    },
    null,
    'execute',
  ])('rejects invalid runtime execution %p before identity or approval', async (execution) => {
    const setup = dependencies(YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST);

    await expect(
      new YclientsControlledCleanupRunner(setup.value).run(
        plan(),
        execution as never,
      ),
    ).resolves.toEqual({
      outcome: 'blocked',
      reason: 'invalid_execution',
      providerRequestCount: 0,
      planDigest: YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
    });
    expect(setup.verify).not.toHaveBeenCalled();
    expect(setup.consume).not.toHaveBeenCalled();
    expect(setup.run).not.toHaveBeenCalled();
  });

  it('blocks a changed identity without consuming approval', async () => {
    const setup = dependencies(YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST);
    setup.verify.mockResolvedValue(false);

    await expect(
      new YclientsControlledCleanupRunner(setup.value).run(plan(), {
        mode: 'execute',
        planDigest: YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
      }),
    ).resolves.toMatchObject({
      outcome: 'blocked',
      reason: 'identity_unverified',
      providerRequestCount: 0,
    });
    expect(setup.consume).not.toHaveBeenCalled();
    expect(setup.run).not.toHaveBeenCalled();
  });

  it('requires the exact plan digest before consuming approval', async () => {
    const setup = dependencies(YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST);

    await expect(
      new YclientsControlledCleanupRunner(setup.value).run(plan(), {
        mode: 'execute',
        planDigest: 'a'.repeat(64),
      }),
    ).resolves.toMatchObject({
      outcome: 'blocked',
      reason: 'digest_mismatch',
      providerRequestCount: 0,
    });
    expect(setup.consume).not.toHaveBeenCalled();
    expect(setup.run).not.toHaveBeenCalled();
  });

  it('consumes a one-time approval and cannot execute twice', async () => {
    const setup = dependencies(YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST);
    const runner = new YclientsControlledCleanupRunner(setup.value);

    await expect(
      runner.run(plan(), {
        mode: 'execute',
        planDigest: YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
      }),
    ).resolves.toEqual({
      outcome: 'executed',
      planDigest: YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
      lifecycle: passed(),
    });
    await expect(
      runner.run(plan(), {
        mode: 'execute',
        planDigest: YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
      }),
    ).resolves.toMatchObject({
      outcome: 'blocked',
      reason: 'approval_consumed',
      providerRequestCount: 0,
    });
    expect(setup.run).toHaveBeenCalledTimes(1);
  });
});

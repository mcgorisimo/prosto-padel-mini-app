import type { YclientsControlledLifecycleResult } from './yclients-controlled-lifecycle';
import {
  createYclientsControlledPlanDigest,
  YclientsControlledRunnerPlan,
  YclientsControlledSingleUseApproval,
  YclientsControlledTestRunner,
} from './yclients-controlled-runner';

const PRIVATE_PHONE = '79990000000';
const PRIVATE_NAME = 'Disposable Test';
const PRIVATE_EMAIL = 'disposable@example.test';
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

function plan(): YclientsControlledRunnerPlan {
  return Object.freeze({
    planVersion: 1,
    planId: 'd2-controlled-basic-1',
    companyId: 2_079_564,
    identityBinding: 'd2-disposable-identity-v1',
    lifecycle: Object.freeze({
      apiId: 7_770_001,
      client: Object.freeze({
        phone: PRIVATE_PHONE,
        fullName: PRIVATE_NAME,
        email: PRIVATE_EMAIL,
      }),
      slotA: Object.freeze({
        alias: 'A' as const,
        serviceId: 30_539_679,
        resourceId: 5_730_531,
        datetime: '2026-08-10T16:30:00+03:00',
      }),
      slotB: Object.freeze({
        alias: 'B' as const,
        serviceId: 30_539_679,
        resourceId: 5_730_532,
        datetime: '2026-08-11T18:00:00+03:00',
      }),
      visibleListA: Object.freeze({
        page: 1,
        count: 50,
        resourceId: 5_730_531,
        dateFrom: '2026-08-10',
        dateTo: '2026-08-10',
        withDeleted: false,
      }),
      deletedListB: Object.freeze({
        page: 1,
        count: 50,
        resourceId: 5_730_532,
        dateFrom: '2026-08-11',
        dateTo: '2026-08-11',
        withDeleted: true,
      }),
    }),
  });
}

function passed(): YclientsControlledLifecycleResult {
  return Object.freeze({
    outcome: 'passed',
    reason: 'complete',
    requestCount: 14,
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
    consume,
    approval,
    value: {
      companyId: 2_079_564,
      identity: { verify },
      approval,
      lifecycle: { create: () => ({ run }) },
    },
  };
}

describe('YclientsControlledTestRunner', () => {
  it('is dry-run by default and performs no provider lifecycle request', async () => {
    const setup = dependencies();
    const result = await new YclientsControlledTestRunner(setup.value).run(
      plan(),
    );

    expect(result).toEqual({
      outcome: 'dry_run_ready',
      planDigest: expect.stringMatching(DIGEST_PATTERN),
      providerRequestCount: 0,
    });
    expect(setup.verify).toHaveBeenCalledTimes(1);
    expect(setup.verify).toHaveBeenCalledWith(
      'd2-disposable-identity-v1',
      plan().lifecycle.client,
    );
    expect(setup.consume).not.toHaveBeenCalled();
    expect(setup.run).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(PRIVATE_PHONE);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_NAME);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_EMAIL);
  });

  it('creates a deterministic non-PII digest bound to every effect field', () => {
    const original = createYclientsControlledPlanDigest(plan());
    const changed = createYclientsControlledPlanDigest({
      ...plan(),
      lifecycle: {
        ...plan().lifecycle,
        slotB: { ...plan().lifecycle.slotB, resourceId: 5_730_533 },
        deletedListB: {
          ...plan().lifecycle.deletedListB,
          resourceId: 5_730_533,
        },
      },
    });
    const changedIdentity = createYclientsControlledPlanDigest({
      ...plan(),
      identityBinding: 'd2-disposable-identity-v2',
    });

    expect(original).toMatch(DIGEST_PATTERN);
    expect(createYclientsControlledPlanDigest(plan())).toBe(original);
    expect(changed).toMatch(DIGEST_PATTERN);
    expect(changed).not.toBe(original);
    expect(changedIdentity).toMatch(DIGEST_PATTERN);
    expect(changedIdentity).not.toBe(original);
    expect(original).not.toContain(PRIVATE_PHONE);
    expect(original).not.toContain(PRIVATE_NAME);
    expect(original).not.toContain(PRIVATE_EMAIL);
  });

  it('fails closed before identity or approval for an invalid plan', async () => {
    const setup = dependencies();
    const invalid = {
      ...plan(),
      lifecycle: {
        ...plan().lifecycle,
        slotA: { ...plan().lifecycle.slotA, datetime: '2026-02-30T12:00:00Z' },
      },
    } as YclientsControlledRunnerPlan;

    await expect(
      new YclientsControlledTestRunner(setup.value).run(invalid),
    ).resolves.toEqual({
      outcome: 'blocked',
      reason: 'invalid_plan',
      providerRequestCount: 0,
    });
    expect(setup.verify).not.toHaveBeenCalled();
    expect(setup.consume).not.toHaveBeenCalled();
    expect(setup.run).not.toHaveBeenCalled();
  });

  it('binds the plan to the exact configured company before identity verification', async () => {
    const setup = dependencies();
    const runner = new YclientsControlledTestRunner({
      ...setup.value,
      companyId: 2_079_565,
    });

    await expect(runner.run(plan())).resolves.toEqual({
      outcome: 'blocked',
      reason: 'invalid_plan',
      providerRequestCount: 0,
    });
    expect(setup.verify).not.toHaveBeenCalled();
    expect(setup.consume).not.toHaveBeenCalled();
    expect(setup.run).not.toHaveBeenCalled();
  });

  it('blocks an unverified disposable identity without consuming approval', async () => {
    const setup = dependencies();
    setup.verify.mockResolvedValue(false);

    const result = await new YclientsControlledTestRunner(setup.value).run(
      plan(),
    );

    expect(result).toMatchObject({
      outcome: 'blocked',
      reason: 'identity_unverified',
      providerRequestCount: 0,
    });
    expect(setup.consume).not.toHaveBeenCalled();
    expect(setup.run).not.toHaveBeenCalled();
  });

  it('rejects a mismatched execution digest before approval or lifecycle', async () => {
    const setup = dependencies('a'.repeat(64));
    const result = await new YclientsControlledTestRunner(setup.value).run(
      plan(),
      { mode: 'execute', planDigest: 'b'.repeat(64) },
    );

    expect(result).toMatchObject({
      outcome: 'blocked',
      reason: 'digest_mismatch',
      providerRequestCount: 0,
    });
    expect(setup.consume).not.toHaveBeenCalled();
    expect(setup.run).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'unexpected', planDigest: 'a'.repeat(64) },
    { mode: null, planDigest: 'a'.repeat(64) },
    { mode: 'execute', planDigest: 'a'.repeat(64), extra: true },
    null,
    'execute',
  ])('rejects an invalid runtime execution shape before identity or approval', async (execution) => {
    const digest = createYclientsControlledPlanDigest(plan())!;
    const setup = dependencies(digest);
    const runtimeExecution =
      execution !== null && typeof execution === 'object'
        ? { ...execution, planDigest: digest }
        : execution;

    await expect(
      new YclientsControlledTestRunner(setup.value).run(
        plan(),
        runtimeExecution as never,
      ),
    ).resolves.toEqual({
      outcome: 'blocked',
      reason: 'invalid_execution',
      providerRequestCount: 0,
      planDigest: digest,
    });
    expect(setup.verify).not.toHaveBeenCalled();
    expect(setup.consume).not.toHaveBeenCalled();
    expect(setup.run).not.toHaveBeenCalled();
  });

  it('requires an approval instead of treating execute as an implicit grant', async () => {
    const digest = createYclientsControlledPlanDigest(plan())!;
    const setup = dependencies();
    const result = await new YclientsControlledTestRunner(setup.value).run(
      plan(),
      { mode: 'execute', planDigest: digest },
    );

    expect(result).toMatchObject({
      outcome: 'blocked',
      reason: 'approval_missing',
      providerRequestCount: 0,
    });
    expect(setup.consume).toHaveBeenCalledTimes(1);
    expect(setup.run).not.toHaveBeenCalled();
  });

  it('rejects an approval bound to another exact plan', async () => {
    const digest = createYclientsControlledPlanDigest(plan())!;
    const setup = dependencies('a'.repeat(64));
    const result = await new YclientsControlledTestRunner(setup.value).run(
      plan(),
      { mode: 'execute', planDigest: digest },
    );

    expect(result).toMatchObject({
      outcome: 'blocked',
      reason: 'approval_mismatch',
      providerRequestCount: 0,
    });
    expect(setup.consume).toHaveBeenCalledTimes(1);
    expect(setup.run).not.toHaveBeenCalled();
  });

  it('consumes exact approval once and never executes the lifecycle twice', async () => {
    const digest = createYclientsControlledPlanDigest(plan())!;
    const setup = dependencies(digest);
    const runner = new YclientsControlledTestRunner(setup.value);

    await expect(
      runner.run(plan(), { mode: 'execute', planDigest: digest }),
    ).resolves.toEqual({
      outcome: 'executed',
      planDigest: digest,
      lifecycle: passed(),
    });
    await expect(
      runner.run(plan(), { mode: 'execute', planDigest: digest }),
    ).resolves.toMatchObject({
      outcome: 'blocked',
      reason: 'approval_consumed',
      providerRequestCount: 0,
    });
    expect(setup.consume).toHaveBeenCalledTimes(2);
    expect(setup.run).toHaveBeenCalledTimes(1);
    expect(setup.run).toHaveBeenCalledWith(plan().lifecycle);
  });
});

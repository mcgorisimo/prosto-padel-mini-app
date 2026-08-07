import { createYclientsControlledCleanupExecutableRunner } from './yclients-controlled-cleanup-executable';
import {
  buildYclientsControlledCleanupOperationalPlan,
  YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
} from './yclients-controlled-cleanup-operational-plan';
import { YclientsControlledLoadedIdentity } from './yclients-controlled-operational-plan';
import type { YclientsControlledPersistentApprovalGate } from './yclients-controlled-runner';

const IDENTITY = new YclientsControlledLoadedIdentity(
  Object.freeze({
    phone: '79990000000',
    fullName: 'Disposable Test',
    email: 'disposable@example.test',
  }),
);

function configuration() {
  const fetch = jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
  const approval: YclientsControlledPersistentApprovalGate = {
    persistence: 'cross_process',
    consume: jest.fn().mockResolvedValue('missing'),
  };
  return {
    fetch,
    approval,
    value: {
      baseUrl: 'https://api.yclients.com',
      companyId: 2_079_564,
      partnerToken: 'partner-secret',
      userToken: 'user-secret',
      requestTimeoutMilliseconds: 5_000,
      fetch,
      clock: {
        nowMilliseconds: () => 0,
        sleep: async () => undefined,
      },
      evidence: { record: jest.fn() },
      identity: IDENTITY,
      approval,
      sourceBindingVerified: true as const,
    },
  };
}

describe('controlled cleanup executable assembly', () => {
  it('keeps dry-run outside provider access', async () => {
    const setup = configuration();
    const runner = createYclientsControlledCleanupExecutableRunner(setup.value);

    await expect(
      runner.run(buildYclientsControlledCleanupOperationalPlan(IDENTITY)),
    ).resolves.toEqual({
      outcome: 'dry_run_ready',
      planDigest: YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
      providerRequestCount: 0,
    });
    expect(setup.fetch).not.toHaveBeenCalled();
    expect(setup.approval.consume).not.toHaveBeenCalled();
  });

  it('rejects a foreign endpoint before constructing a runnable assembly', () => {
    const setup = configuration();
    expect(() =>
      createYclientsControlledCleanupExecutableRunner({
        ...setup.value,
        baseUrl: 'https://foreign.example.test',
      }),
    ).toThrow('endpoint');
    expect(setup.fetch).not.toHaveBeenCalled();
  });

  it('requires both a persistent approval and verified source binding', () => {
    const setup = configuration();
    expect(() =>
      createYclientsControlledCleanupExecutableRunner({
        ...setup.value,
        sourceBindingVerified: false,
      } as never),
    ).toThrow('persistent gates');
    expect(() =>
      createYclientsControlledCleanupExecutableRunner({
        ...setup.value,
        approval: { persistence: 'memory', consume: jest.fn() },
      } as never),
    ).toThrow('persistent gates');
    expect(setup.fetch).not.toHaveBeenCalled();
  });
});

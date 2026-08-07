import { createYclientsControlledExecutableRunner } from './yclients-controlled-executable';
import type { YclientsControlledRunnerPlan } from './yclients-controlled-runner';

const PRIVATE_PHONE = '79990000000';
const PRIVATE_NAME = 'Disposable Test';
const PRIVATE_EMAIL = 'disposable@example.test';

function plan(): YclientsControlledRunnerPlan {
  return {
    planVersion: 1,
    planId: 'd2-controlled-basic-1',
    companyId: 2_079_564,
    identityBinding: 'd2-disposable-identity-v1',
    lifecycle: {
      apiId: 7_770_001,
      client: {
        phone: PRIVATE_PHONE,
        fullName: PRIVATE_NAME,
        email: PRIVATE_EMAIL,
      },
      slotA: {
        alias: 'A',
        serviceId: 30_539_679,
        resourceId: 5_730_531,
        datetime: '2026-08-10T16:30:00+03:00',
      },
      slotB: {
        alias: 'B',
        serviceId: 30_539_679,
        resourceId: 5_760_241,
        datetime: '2026-08-11T18:00:00+03:00',
      },
      visibleListA: {
        page: 1,
        count: 50,
        resourceId: 5_730_531,
        dateFrom: '2026-08-10',
        dateTo: '2026-08-10',
        withDeleted: false,
      },
      deletedListB: {
        page: 1,
        count: 50,
        resourceId: 5_760_241,
        dateFrom: '2026-08-11',
        dateTo: '2026-08-11',
        withDeleted: true,
      },
    },
  };
}

describe('createYclientsControlledExecutableRunner', () => {
  it('assembles the concrete clients but keeps default dry-run at zero fetch', async () => {
    const fetch = jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
    const verify = jest.fn().mockResolvedValue(true);
    const result = await createYclientsControlledExecutableRunner({
      baseUrl: 'https://api.yclients.com/',
      companyId: 2_079_564,
      partnerToken: 'partner-test-credential',
      userToken: 'user-test-credential',
      requestTimeoutMilliseconds: 5_000,
      fetch,
      clock: {
        nowMilliseconds: () => 0,
        sleep: async () => undefined,
      },
      evidence: { record: () => undefined },
      bindings: {
        persistence: 'root_only_exclusive',
        record: () => undefined,
      },
      identity: { verify },
      approval: {
        persistence: 'cross_process',
        consume: () => 'missing',
      },
    }).run(plan());

    expect(result).toMatchObject({
      outcome: 'dry_run_ready',
      providerRequestCount: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_PHONE);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_NAME);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_EMAIL);
    expect(JSON.stringify(result)).not.toContain('credential');
  });

  it.each([
    'http://api.yclients.com',
    'https://foreign.example.test',
    'https://user:password@api.yclients.com',
    'https://api.yclients.com?token=value',
    'https://api.yclients.com/#fragment',
    'https://api.yclients.com/foreign-path',
  ])('rejects an unapproved endpoint before identity, approval, or fetch: %s', async (baseUrl) => {
    const fetch = jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
    const verify = jest.fn();
    const consume = jest.fn();

    expect(() =>
      createYclientsControlledExecutableRunner({
        baseUrl,
        companyId: 2_079_564,
        partnerToken: 'partner-test-credential',
        userToken: 'user-test-credential',
        requestTimeoutMilliseconds: 5_000,
        fetch,
        clock: {
          nowMilliseconds: () => 0,
          sleep: async () => undefined,
        },
        evidence: { record: () => undefined },
        bindings: {
          persistence: 'root_only_exclusive',
          record: () => undefined,
        },
        identity: { verify },
        approval: {
          persistence: 'cross_process',
          consume,
        },
      }),
    ).toThrow('Invalid controlled YCLIENTS endpoint');
    expect(verify).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

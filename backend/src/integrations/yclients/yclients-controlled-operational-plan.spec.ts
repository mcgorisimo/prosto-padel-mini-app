import type { YclientsControlledRootOnlyFileStore } from './yclients-controlled-artifacts';
import {
  buildYclientsControlledOperationalPlan,
  createYclientsControlledExecutionApprovalDigest,
  loadYclientsControlledIdentity,
  loadYclientsControlledRootOnlySecret,
  YclientsControlledLoadedIdentity,
  YCLIENTS_CONTROLLED_IDENTITY_BINDING,
  YCLIENTS_CONTROLLED_PLAN_DIGEST,
} from './yclients-controlled-operational-plan';
import { createYclientsControlledPlanDigest } from './yclients-controlled-runner';

const PRIVATE_PHONE = '79990000000';
const PRIVATE_NAME = 'Disposable Test';
const PRIVATE_EMAIL = 'disposable@example.test';

function identityJson(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    binding: YCLIENTS_CONTROLLED_IDENTITY_BINDING,
    fullName: PRIVATE_NAME,
    phone: PRIVATE_PHONE,
    email: PRIVATE_EMAIL,
    ...extra,
  });
}

function storeWith(value?: string): YclientsControlledRootOnlyFileStore {
  return {
    read: jest.fn().mockResolvedValue(value),
    claim: jest.fn(),
  };
}

describe('controlled operational identity and plan', () => {
  it('loads an identity and builds the reviewed digest without PII projection', async () => {
    const identity = await loadYclientsControlledIdentity(
      storeWith(`${identityJson()}\n`),
      '/root/controlled/identity.json',
    );
    const plan = buildYclientsControlledOperationalPlan(identity);

    expect(identity.verify(identity.binding, plan.lifecycle.client)).toBe(true);
    expect(createYclientsControlledPlanDigest(plan)).toBe(
      YCLIENTS_CONTROLLED_PLAN_DIGEST,
    );
    expect(plan).toMatchObject({
      planVersion: 1,
      planId: 'd2-controlled-basic-20260817',
      companyId: 2_079_564,
      identityBinding: YCLIENTS_CONTROLLED_IDENTITY_BINDING,
      lifecycle: {
        slotA: {
          resourceId: 5_730_531,
          serviceId: 30_539_679,
          datetime: '2026-08-17T12:00:00+03:00',
        },
        slotB: {
          resourceId: 5_762_241,
          serviceId: 30_539_679,
          datetime: '2026-08-18T12:00:00+03:00',
        },
      },
    });
    const safeIdentity = JSON.stringify(identity);
    const digest = createYclientsControlledPlanDigest(plan)!;
    for (const forbidden of [PRIVATE_PHONE, PRIVATE_NAME, PRIVATE_EMAIL]) {
      expect(safeIdentity).not.toContain(forbidden);
      expect(digest).not.toContain(forbidden);
    }
  });

  it('derives an opaque keyed approval digest that changes with identity or root-only keys', () => {
    const identity = new YclientsControlledLoadedIdentity({
      phone: PRIVATE_PHONE,
      fullName: PRIVATE_NAME,
      email: PRIVATE_EMAIL,
    });
    const replacement = new YclientsControlledLoadedIdentity({
      phone: '78880000000',
      fullName: 'Replacement Identity',
      email: 'replacement@example.test',
    });
    const digest = createYclientsControlledExecutionApprovalDigest(
      identity,
      YCLIENTS_CONTROLLED_PLAN_DIGEST,
      'partner-secret',
      'user-secret',
    );

    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      createYclientsControlledExecutionApprovalDigest(
        replacement,
        YCLIENTS_CONTROLLED_PLAN_DIGEST,
        'partner-secret',
        'user-secret',
      ),
    ).not.toBe(digest);
    expect(
      createYclientsControlledExecutionApprovalDigest(
        identity,
        YCLIENTS_CONTROLLED_PLAN_DIGEST,
        'other-partner-secret',
        'user-secret',
      ),
    ).not.toBe(digest);
    for (const forbidden of [PRIVATE_PHONE, PRIVATE_NAME, PRIVATE_EMAIL]) {
      expect(digest).not.toContain(forbidden);
    }
  });

  it.each([
    ['missing', undefined],
    ['extra key', identityJson({ extra: true })],
    [
      'wrong binding',
      identityJson({ binding: 'd2-disposable-identity-v2' }),
    ],
    ['invalid phone', identityJson({ phone: '+79990000000' })],
    ['invalid email', identityJson({ email: 'invalid' })],
    ['control text', identityJson({ fullName: 'Unsafe\nName' })],
    [
      'non-canonical order',
      JSON.stringify({
        binding: YCLIENTS_CONTROLLED_IDENTITY_BINDING,
        version: 1,
        fullName: PRIVATE_NAME,
        phone: PRIVATE_PHONE,
        email: PRIVATE_EMAIL,
      }),
    ],
  ])('rejects %s identity without echoing PII', async (_name, value) => {
    let error: unknown;
    try {
      await loadYclientsControlledIdentity(
        storeWith(value),
        '/root/controlled/identity.json',
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TypeError);
    const safe = String(error);
    expect(safe).toBe('TypeError: Invalid controlled identity');
    expect(safe).not.toContain(PRIVATE_PHONE);
    expect(safe).not.toContain(PRIVATE_NAME);
    expect(safe).not.toContain(PRIVATE_EMAIL);
  });

  it.each(['wrong_owner', 'symlink', 'unsafe_mode'])
    ('fails closed when the root-only store rejects %s', async (reason) => {
      const store: YclientsControlledRootOnlyFileStore = {
        read: jest.fn().mockRejectedValue(new Error(reason)),
        claim: jest.fn(),
      };

      await expect(
        loadYclientsControlledIdentity(
          store,
          '/root/controlled/identity.json',
        ),
      ).rejects.toThrow('Invalid controlled identity');
      expect(JSON.stringify(store)).not.toContain(PRIVATE_PHONE);
    });

  it('loads a root-only token without retaining its trailing newline', async () => {
    await expect(
      loadYclientsControlledRootOnlySecret(
        storeWith('server-side-token\n'),
        '/root/controlled/token',
      ),
    ).resolves.toBe('server-side-token');
    await expect(
      loadYclientsControlledRootOnlySecret(
        storeWith('bad\ntoken'),
        '/root/controlled/token',
      ),
    ).rejects.toThrow('Invalid controlled secret');
  });
});

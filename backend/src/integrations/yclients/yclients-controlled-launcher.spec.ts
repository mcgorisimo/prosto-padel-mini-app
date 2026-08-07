import type { YclientsControlledRootOnlyFileStore } from './yclients-controlled-artifacts';
import {
  parseYclientsControlledLauncherArguments,
  runYclientsControlledLauncher,
  YCLIENTS_CONTROLLED_APPROVAL_FILE,
  YCLIENTS_CONTROLLED_ARTIFACT_DIRECTORY,
  YCLIENTS_CONTROLLED_BINDING_FILE,
  YCLIENTS_CONTROLLED_CONSUMED_APPROVAL_FILE,
  YCLIENTS_CONTROLLED_IDENTITY_FILE,
  YCLIENTS_CONTROLLED_PARTNER_TOKEN_FILE,
  YCLIENTS_CONTROLLED_USER_TOKEN_FILE,
  YclientsControlledLauncherDependencies,
} from './yclients-controlled-launcher';
import {
  createYclientsControlledExecutionApprovalDigest,
  loadYclientsControlledIdentity,
  YclientsControlledLoadedIdentity,
  YCLIENTS_CONTROLLED_IDENTITY_BINDING,
  YCLIENTS_CONTROLLED_PLAN_DIGEST,
} from './yclients-controlled-operational-plan';

const PRIVATE_PHONE = '79990000000';
const PRIVATE_NAME = 'Disposable Test';
const PRIVATE_EMAIL = 'disposable@example.test';
const IDENTITY_FILE = YCLIENTS_CONTROLLED_IDENTITY_FILE;
const ARTIFACT_DIRECTORY = YCLIENTS_CONTROLLED_ARTIFACT_DIRECTORY;
const PARTNER_TOKEN_FILE = YCLIENTS_CONTROLLED_PARTNER_TOKEN_FILE;
const USER_TOKEN_FILE = YCLIENTS_CONTROLLED_USER_TOKEN_FILE;
const TEST_IDENTITY = new YclientsControlledLoadedIdentity(
  Object.freeze({
    phone: PRIVATE_PHONE,
    fullName: PRIVATE_NAME,
    email: PRIVATE_EMAIL,
  }),
);

function identityJson(
  client: Readonly<{
    fullName: string;
    phone: string;
    email: string;
  }> = TEST_IDENTITY.clientForPlan(),
): string {
  return JSON.stringify({
    version: 1,
    binding: YCLIENTS_CONTROLLED_IDENTITY_BINDING,
    fullName: client.fullName,
    phone: client.phone,
    email: client.email,
  });
}

function approvalDigest(identity = TEST_IDENTITY): string {
  return createYclientsControlledExecutionApprovalDigest(
    identity,
    YCLIENTS_CONTROLLED_PLAN_DIGEST,
    'partner-secret',
    'user-secret',
  );
}

function argv(extra: readonly string[] = []): string[] {
  return [
    '--api-base-url',
    'https://api.yclients.com',
    '--identity-file',
    IDENTITY_FILE,
    '--artifact-dir',
    ARTIFACT_DIRECTORY,
    '--partner-token-file',
    PARTNER_TOKEN_FILE,
    '--user-token-file',
    USER_TOKEN_FILE,
    ...extra,
  ];
}

class MemoryStore implements YclientsControlledRootOnlyFileStore {
  readonly files = new Map<string, string>([
    [IDENTITY_FILE, `${identityJson()}\n`],
    [PARTNER_TOKEN_FILE, 'partner-secret\n'],
    [USER_TOKEN_FILE, 'user-secret\n'],
  ]);
  readonly read = jest.fn(async (path: string) => this.files.get(path));
  readonly claim = jest.fn(
    async (): Promise<'claimed' | 'exists'> => 'claimed',
  );
}

function dependencies(overrides: {
  effectiveUid?: number | undefined;
  store?: YclientsControlledRootOnlyFileStore;
  loadIdentity?: YclientsControlledLauncherDependencies['loadIdentity'];
} = {}) {
  const store = overrides.store ?? new MemoryStore();
  const fetch = jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
  const outputs: string[] = [];
  const createStore = jest.fn(() => store);
  const value: YclientsControlledLauncherDependencies = {
    effectiveUid: () =>
      Object.prototype.hasOwnProperty.call(overrides, 'effectiveUid')
        ? overrides.effectiveUid
        : 0,
    createStore,
    loadIdentity:
      overrides.loadIdentity ?? (async () => TEST_IDENTITY),
    fetch,
    nowMilliseconds: () => 0,
    sleep: async () => undefined,
    writeOutput: (line) => {
      outputs.push(line);
    },
  };
  return { value, store, fetch, outputs, createStore };
}

describe('controlled launcher', () => {
  it('parses the allowlisted dry-run command and defaults to dry-run', () => {
    expect(parseYclientsControlledLauncherArguments(argv())).toEqual({
      mode: 'dry_run',
      apiBaseUrl: 'https://api.yclients.com',
      identityFile: IDENTITY_FILE,
      artifactDirectory: ARTIFACT_DIRECTORY,
      partnerTokenFile: PARTNER_TOKEN_FILE,
      userTokenFile: USER_TOKEN_FILE,
    });
    expect(
      parseYclientsControlledLauncherArguments(
        argv([
          '--mode',
          'execute',
          '--plan-digest',
          YCLIENTS_CONTROLLED_PLAN_DIGEST,
        ]),
      ),
    ).toMatchObject({
      mode: 'execute',
      planDigest: YCLIENTS_CONTROLLED_PLAN_DIGEST,
    });
  });

  it.each([
    ['unknown flag', argv(['--unknown', 'value'])],
    ['unknown mode', argv(['--mode', 'write'])],
    ['extra positional', [...argv(), 'extra']],
    ['duplicate', [...argv(), '--identity-file', IDENTITY_FILE]],
    ['foreign endpoint', argv().map((value) =>
      value === 'https://api.yclients.com'
        ? 'https://foreign.example.test'
        : value,
    )],
    ['digest on dry-run', argv(['--plan-digest', YCLIENTS_CONTROLLED_PLAN_DIGEST])],
    ['missing execute digest', argv(['--mode', 'execute'])],
    [
      'alternate identity path',
      argv().map((value) =>
        value === IDENTITY_FILE ? `${IDENTITY_FILE}.replacement` : value,
      ),
    ],
    [
      'alternate artifact path',
      argv().map((value) =>
        value === ARTIFACT_DIRECTORY
          ? `${ARTIFACT_DIRECTORY}-replacement`
          : value,
      ),
    ],
    [
      'wrong execute digest',
      argv(['--mode', 'execute', '--plan-digest', 'a'.repeat(64)]),
    ],
  ])('rejects malformed CLI %s before file or provider access', async (_name, invalidArgv) => {
    const setup = dependencies();

    await expect(
      runYclientsControlledLauncher(invalidArgv, setup.value),
    ).resolves.toBe(2);
    expect(setup.createStore).not.toHaveBeenCalled();
    expect(setup.fetch).not.toHaveBeenCalled();
    expect(setup.outputs).toEqual([
      `${JSON.stringify({ outcome: 'invalid_arguments' })}\n`,
    ]);
  });

  it('requires root before loading identity, secrets, or provider clients', async () => {
    const setup = dependencies({ effectiveUid: 1_001 });

    await expect(
      runYclientsControlledLauncher(argv(), setup.value),
    ).resolves.toBe(2);
    expect(setup.createStore).not.toHaveBeenCalled();
    expect(setup.fetch).not.toHaveBeenCalled();
    expect(setup.outputs).toEqual([
      `${JSON.stringify({ outcome: 'owner_required' })}\n`,
    ]);
  });

  it('runs the compiled operational assembly as dry-run with zero provider calls', async () => {
    const setup = dependencies();

    await expect(
      runYclientsControlledLauncher(argv(), setup.value),
    ).resolves.toBe(0);
    expect(setup.createStore).toHaveBeenCalledWith(0);
    expect(setup.fetch).not.toHaveBeenCalled();
    expect((setup.store as MemoryStore).claim).not.toHaveBeenCalled();
    expect(setup.outputs).toHaveLength(1);
    expect(JSON.parse(setup.outputs[0])).toEqual({
      outcome: 'dry_run_ready',
      planDigest: YCLIENTS_CONTROLLED_PLAN_DIGEST,
      providerRequestCount: 0,
      approvalDigest: approvalDigest(),
    });
    const output = setup.outputs.join('');
    for (const forbidden of [
      PRIVATE_PHONE,
      PRIVATE_NAME,
      PRIVATE_EMAIL,
      'partner-secret',
      'user-secret',
    ]) {
      expect(output).not.toContain(forbidden);
    }
  });

  it.each([
    [YCLIENTS_CONTROLLED_APPROVAL_FILE, `${YCLIENTS_CONTROLLED_PLAN_DIGEST}\n`],
    [YCLIENTS_CONTROLLED_CONSUMED_APPROVAL_FILE, `${YCLIENTS_CONTROLLED_PLAN_DIGEST}\n`],
    [YCLIENTS_CONTROLLED_BINDING_FILE, '{"recordId":1}\n'],
  ])('rejects a stale dry-run artifact %s before identity or provider work', async (path, value) => {
    const store = new MemoryStore();
    store.files.set(path, value);
    const setup = dependencies({ store });

    await expect(
      runYclientsControlledLauncher(argv(), setup.value),
    ).resolves.toBe(2);
    expect(setup.fetch).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
    expect(setup.outputs).toEqual([
      `${JSON.stringify({ outcome: 'configuration_rejected' })}\n`,
    ]);
  });

  it('rejects changed identity contents before approval or provider work', async () => {
    const store = new MemoryStore();
    store.files.set(
      IDENTITY_FILE,
      `${identityJson({
        fullName: 'Replacement Identity',
        phone: '78880000000',
        email: 'replacement@example.test',
      })}\n`,
    );
    store.files.set(
      YCLIENTS_CONTROLLED_APPROVAL_FILE,
      `${approvalDigest()}\n`,
    );
    const setup = dependencies({
      store,
      loadIdentity: loadYclientsControlledIdentity,
    });

    await expect(
      runYclientsControlledLauncher(
        argv([
          '--mode',
          'execute',
          '--plan-digest',
          YCLIENTS_CONTROLLED_PLAN_DIGEST,
        ]),
        setup.value,
      ),
    ).resolves.toBe(2);
    expect(store.claim).not.toHaveBeenCalled();
    expect(setup.fetch).not.toHaveBeenCalled();
    expect(setup.outputs).toEqual([
      `${JSON.stringify({ outcome: 'configuration_rejected' })}\n`,
    ]);
  });

  it.each(['wrong_owner', 'symlink', 'unsafe_mode'])
    ('maps identity/config store rejection %s to a PII-safe outcome', async (reason) => {
      const store: YclientsControlledRootOnlyFileStore = {
        read: jest.fn().mockRejectedValue(new Error(reason)),
        claim: jest.fn(),
      };
      const setup = dependencies({ store });

      await expect(
        runYclientsControlledLauncher(argv(), setup.value),
      ).resolves.toBe(2);
      expect(setup.fetch).not.toHaveBeenCalled();
      const output = setup.outputs.join('');
      expect(output).toBe(
        `${JSON.stringify({ outcome: 'configuration_rejected' })}\n`,
      );
      expect(output).not.toContain(PRIVATE_PHONE);
      expect(output).not.toContain(PRIVATE_NAME);
      expect(output).not.toContain(PRIVATE_EMAIL);
      expect(output).not.toContain(reason);
    });
});

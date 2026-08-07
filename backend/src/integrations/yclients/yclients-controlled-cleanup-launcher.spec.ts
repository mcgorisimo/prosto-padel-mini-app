import type { YclientsControlledRootOnlyFileStore } from './yclients-controlled-artifacts';
import {
  parseYclientsControlledCleanupLauncherArguments,
  runYclientsControlledCleanupLauncher,
  YCLIENTS_CONTROLLED_CLEANUP_APPROVAL_FILE,
  YCLIENTS_CONTROLLED_CLEANUP_ARTIFACT_DIRECTORY,
  YCLIENTS_CONTROLLED_CLEANUP_CONSUMED_FILE,
  YclientsControlledCleanupLauncherDependencies,
} from './yclients-controlled-cleanup-launcher';
import { YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST } from './yclients-controlled-cleanup-operational-plan';
import {
  createYclientsControlledExecutionApprovalDigest,
  loadYclientsControlledIdentity,
  YclientsControlledLoadedIdentity,
  YCLIENTS_CONTROLLED_IDENTITY_BINDING,
} from './yclients-controlled-operational-plan';
import {
  YCLIENTS_CONTROLLED_BINDING_FILE,
  YCLIENTS_CONTROLLED_IDENTITY_FILE,
  YCLIENTS_CONTROLLED_PARTNER_TOKEN_FILE,
  YCLIENTS_CONTROLLED_USER_TOKEN_FILE,
} from './yclients-controlled-launcher';

const PRIVATE_PHONE = '79990000000';
const PRIVATE_NAME = 'Disposable Test';
const PRIVATE_EMAIL = 'disposable@example.test';
const SOURCE_BINDING =
  '{"version":1,"slot":"A","appointmentId":1,"recordId":1891713981}\n';
const IDENTITY = new YclientsControlledLoadedIdentity(
  Object.freeze({
    phone: PRIVATE_PHONE,
    fullName: PRIVATE_NAME,
    email: PRIVATE_EMAIL,
  }),
);

function identityJson(
  client: Readonly<{ phone: string; fullName: string; email: string }> =
    IDENTITY.clientForPlan(),
): string {
  return JSON.stringify({
    version: 1,
    binding: YCLIENTS_CONTROLLED_IDENTITY_BINDING,
    fullName: client.fullName,
    phone: client.phone,
    email: client.email,
  });
}

function approvalDigest(identity = IDENTITY): string {
  return createYclientsControlledExecutionApprovalDigest(
    identity,
    YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
    'partner-secret',
    'user-secret',
  );
}

function argv(extra: readonly string[] = []): string[] {
  return [
    '--api-base-url',
    'https://api.yclients.com',
    '--identity-file',
    YCLIENTS_CONTROLLED_IDENTITY_FILE,
    '--source-binding-file',
    YCLIENTS_CONTROLLED_BINDING_FILE,
    '--artifact-dir',
    YCLIENTS_CONTROLLED_CLEANUP_ARTIFACT_DIRECTORY,
    '--partner-token-file',
    YCLIENTS_CONTROLLED_PARTNER_TOKEN_FILE,
    '--user-token-file',
    YCLIENTS_CONTROLLED_USER_TOKEN_FILE,
    ...extra,
  ];
}

class MemoryStore implements YclientsControlledRootOnlyFileStore {
  readonly files = new Map<string, string>([
    [YCLIENTS_CONTROLLED_IDENTITY_FILE, `${identityJson()}\n`],
    [YCLIENTS_CONTROLLED_PARTNER_TOKEN_FILE, 'partner-secret\n'],
    [YCLIENTS_CONTROLLED_USER_TOKEN_FILE, 'user-secret\n'],
    [YCLIENTS_CONTROLLED_BINDING_FILE, SOURCE_BINDING],
  ]);
  readonly read = jest.fn(async (path: string) => this.files.get(path));
  readonly claim = jest.fn(
    async (path: string, contents: string): Promise<'claimed' | 'exists'> => {
      if (this.files.has(path)) return 'exists';
      this.files.set(path, contents);
      return 'claimed';
    },
  );
}

function dependencies(overrides: {
  effectiveUid?: number | undefined;
  store?: YclientsControlledRootOnlyFileStore;
  loadIdentity?: YclientsControlledCleanupLauncherDependencies['loadIdentity'];
} = {}) {
  const store = overrides.store ?? new MemoryStore();
  const fetch = jest.fn() as jest.MockedFunction<typeof globalThis.fetch>;
  const outputs: string[] = [];
  const createStore = jest.fn(() => store);
  const value: YclientsControlledCleanupLauncherDependencies = {
    effectiveUid: () =>
      Object.prototype.hasOwnProperty.call(overrides, 'effectiveUid')
        ? overrides.effectiveUid
        : 0,
    createStore,
    loadIdentity: overrides.loadIdentity ?? (async () => IDENTITY),
    fetch,
    nowMilliseconds: () => 0,
    sleep: async () => undefined,
    writeOutput: (line) => {
      outputs.push(line);
    },
  };
  return { value, store, fetch, outputs, createStore };
}

describe('record-specific cleanup launcher', () => {
  it('accepts only the exact fixed dry-run and execute commands', () => {
    expect(parseYclientsControlledCleanupLauncherArguments(argv())).toEqual({
      mode: 'dry_run',
      apiBaseUrl: 'https://api.yclients.com',
      identityFile: YCLIENTS_CONTROLLED_IDENTITY_FILE,
      sourceBindingFile: YCLIENTS_CONTROLLED_BINDING_FILE,
      artifactDirectory: YCLIENTS_CONTROLLED_CLEANUP_ARTIFACT_DIRECTORY,
      partnerTokenFile: YCLIENTS_CONTROLLED_PARTNER_TOKEN_FILE,
      userTokenFile: YCLIENTS_CONTROLLED_USER_TOKEN_FILE,
    });
    expect(
      parseYclientsControlledCleanupLauncherArguments(
        argv([
          '--mode',
          'execute',
          '--plan-digest',
          YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
        ]),
      ),
    ).toMatchObject({
      mode: 'execute',
      planDigest: YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
    });
  });

  it.each([
    ['unknown flag', argv(['--unknown', 'value'])],
    ['unknown mode', argv(['--mode', 'write'])],
    ['extra positional', [...argv(), 'extra']],
    ['duplicate flag', [...argv(), '--identity-file', YCLIENTS_CONTROLLED_IDENTITY_FILE]],
    [
      'foreign endpoint',
      argv().map((value) =>
        value === 'https://api.yclients.com'
          ? 'https://foreign.example.test'
          : value,
      ),
    ],
    [
      'alternate binding',
      argv().map((value) =>
        value === YCLIENTS_CONTROLLED_BINDING_FILE ? `${value}.other` : value,
      ),
    ],
    [
      'alternate identity',
      argv().map((value) =>
        value === YCLIENTS_CONTROLLED_IDENTITY_FILE ? `${value}.other` : value,
      ),
    ],
    [
      'alternate artifacts',
      argv().map((value) =>
        value === YCLIENTS_CONTROLLED_CLEANUP_ARTIFACT_DIRECTORY
          ? `${value}.other`
          : value,
      ),
    ],
    [
      'alternate partner token',
      argv().map((value) =>
        value === YCLIENTS_CONTROLLED_PARTNER_TOKEN_FILE
          ? `${value}.other`
          : value,
      ),
    ],
    [
      'alternate user token',
      argv().map((value) =>
        value === YCLIENTS_CONTROLLED_USER_TOKEN_FILE
          ? `${value}.other`
          : value,
      ),
    ],
    ['digest on dry-run', argv(['--plan-digest', YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST])],
    ['execute without digest', argv(['--mode', 'execute'])],
    [
      'wrong digest',
      argv(['--mode', 'execute', '--plan-digest', 'a'.repeat(64)]),
    ],
  ])('rejects %s before file or provider access', async (_name, invalidArgv) => {
    const setup = dependencies();

    await expect(
      runYclientsControlledCleanupLauncher(invalidArgv, setup.value),
    ).resolves.toBe(2);
    expect(setup.createStore).not.toHaveBeenCalled();
    expect(setup.fetch).not.toHaveBeenCalled();
    expect(setup.outputs).toEqual([
      `${JSON.stringify({ outcome: 'invalid_arguments' })}\n`,
    ]);
  });

  it('requires root before any file or provider access', async () => {
    const setup = dependencies({ effectiveUid: 1_001 });

    await expect(
      runYclientsControlledCleanupLauncher(argv(), setup.value),
    ).resolves.toBe(2);
    expect(setup.createStore).not.toHaveBeenCalled();
    expect(setup.fetch).not.toHaveBeenCalled();
  });

  it('performs a dry-run with exact source binding and zero provider calls', async () => {
    const setup = dependencies();

    await expect(
      runYclientsControlledCleanupLauncher(argv(), setup.value),
    ).resolves.toBe(0);
    expect(setup.fetch).not.toHaveBeenCalled();
    expect((setup.store as MemoryStore).claim).not.toHaveBeenCalled();
    expect(setup.outputs).toHaveLength(1);
    expect(JSON.parse(setup.outputs[0])).toEqual({
      outcome: 'dry_run_ready',
      planDigest: YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
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
    [YCLIENTS_CONTROLLED_CLEANUP_APPROVAL_FILE, `${approvalDigest()}\n`],
    [YCLIENTS_CONTROLLED_CLEANUP_CONSUMED_FILE, `${approvalDigest()}\n`],
  ])('rejects stale cleanup artifact %s before identity/provider work', async (path, value) => {
    const store = new MemoryStore();
    store.files.set(path, value);
    const loadIdentity = jest.fn(async () => IDENTITY);
    const setup = dependencies({ store, loadIdentity });

    await expect(
      runYclientsControlledCleanupLauncher(argv(), setup.value),
    ).resolves.toBe(2);
    expect(loadIdentity).not.toHaveBeenCalled();
    expect(setup.fetch).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
  });

  it('rejects missing or changed durable source binding before identity/provider work', async () => {
    const store = new MemoryStore();
    store.files.set(
      YCLIENTS_CONTROLLED_BINDING_FILE,
      '{"version":1,"slot":"A","appointmentId":1,"recordId":1891713982}\n',
    );
    const loadIdentity = jest.fn(async () => IDENTITY);
    const setup = dependencies({ store, loadIdentity });

    await expect(
      runYclientsControlledCleanupLauncher(argv(), setup.value),
    ).resolves.toBe(2);
    expect(loadIdentity).not.toHaveBeenCalled();
    expect(setup.fetch).not.toHaveBeenCalled();
  });

  it('rejects changed identity against approval before consume or provider work', async () => {
    const store = new MemoryStore();
    store.files.set(
      YCLIENTS_CONTROLLED_IDENTITY_FILE,
      `${identityJson({
        phone: '78880000000',
        fullName: 'Replacement Identity',
        email: 'replacement@example.test',
      })}\n`,
    );
    store.files.set(
      YCLIENTS_CONTROLLED_CLEANUP_APPROVAL_FILE,
      `${approvalDigest()}\n`,
    );
    const setup = dependencies({
      store,
      loadIdentity: loadYclientsControlledIdentity,
    });

    await expect(
      runYclientsControlledCleanupLauncher(
        argv([
          '--mode',
          'execute',
          '--plan-digest',
          YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
        ]),
        setup.value,
      ),
    ).resolves.toBe(2);
    expect(store.claim).not.toHaveBeenCalled();
    expect(setup.fetch).not.toHaveBeenCalled();
    const output = setup.outputs.join('');
    expect(output).toBe(
      `${JSON.stringify({ outcome: 'configuration_rejected' })}\n`,
    );
    expect(output).not.toContain('Replacement Identity');
    expect(output).not.toContain('78880000000');
  });
});

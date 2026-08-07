import { YCLIENTS_API_DEFAULT_BASE_URL } from '../../config/yclients-api.config';
import {
  YclientsControlledApprovalFileGate,
  YclientsControlledBindingArtifactFileSink,
  YclientsControlledNodeRootOnlyFileStore,
  YclientsControlledRootOnlyFileStore,
} from './yclients-controlled-artifacts';
import { createYclientsControlledExecutableRunner } from './yclients-controlled-executable';
import type { YclientsControlledEvidenceEvent } from './yclients-controlled-lifecycle';
import {
  buildYclientsControlledOperationalPlan,
  createYclientsControlledExecutionApprovalDigest,
  loadYclientsControlledIdentity,
  loadYclientsControlledRootOnlySecret,
  YclientsControlledLoadedIdentity,
  YCLIENTS_CONTROLLED_PLAN_DIGEST,
} from './yclients-controlled-operational-plan';

export const YCLIENTS_CONTROLLED_OPERATIONAL_ROOT =
  '/root/prosto-padel-d2-controlled';
export const YCLIENTS_CONTROLLED_IDENTITY_FILE =
  `${YCLIENTS_CONTROLLED_OPERATIONAL_ROOT}/secrets/identity.json`;
export const YCLIENTS_CONTROLLED_ARTIFACT_DIRECTORY =
  `${YCLIENTS_CONTROLLED_OPERATIONAL_ROOT}/artifacts`;
export const YCLIENTS_CONTROLLED_PARTNER_TOKEN_FILE =
  `${YCLIENTS_CONTROLLED_OPERATIONAL_ROOT}/secrets/yclients-partner-token`;
export const YCLIENTS_CONTROLLED_USER_TOKEN_FILE =
  `${YCLIENTS_CONTROLLED_OPERATIONAL_ROOT}/secrets/yclients-user-token`;
export const YCLIENTS_CONTROLLED_APPROVAL_FILE =
  `${YCLIENTS_CONTROLLED_ARTIFACT_DIRECTORY}/approval.sha256`;
export const YCLIENTS_CONTROLLED_CONSUMED_APPROVAL_FILE =
  `${YCLIENTS_CONTROLLED_ARTIFACT_DIRECTORY}/approval.sha256.consumed`;
export const YCLIENTS_CONTROLLED_BINDING_FILE =
  `${YCLIENTS_CONTROLLED_ARTIFACT_DIRECTORY}/provider-binding.json`;
export const YCLIENTS_CONTROLLED_OWNER_CHECK_FILE =
  `${YCLIENTS_CONTROLLED_ARTIFACT_DIRECTORY}/.owner-check`;

type LauncherMode = 'dry_run' | 'execute';

export type YclientsControlledLauncherArguments = Readonly<{
  mode: LauncherMode;
  apiBaseUrl: string;
  identityFile: string;
  artifactDirectory: string;
  partnerTokenFile: string;
  userTokenFile: string;
  planDigest?: string;
}>;

export type YclientsControlledLauncherDependencies = Readonly<{
  effectiveUid(): number | undefined;
  createStore(expectedUid: number): YclientsControlledRootOnlyFileStore;
  loadIdentity(
    store: YclientsControlledRootOnlyFileStore,
    identityPath: string,
  ): Promise<YclientsControlledLoadedIdentity>;
  fetch: typeof globalThis.fetch;
  nowMilliseconds(): number;
  sleep(milliseconds: number): Promise<void>;
  writeOutput(line: string): void | Promise<void>;
}>;

const VALUE_FLAGS = new Set([
  '--mode',
  '--api-base-url',
  '--identity-file',
  '--artifact-dir',
  '--partner-token-file',
  '--user-token-file',
  '--plan-digest',
]);

export function parseYclientsControlledLauncherArguments(
  argv: readonly string[],
): YclientsControlledLauncherArguments | undefined {
  if (argv.length % 2 !== 0) return undefined;
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !VALUE_FLAGS.has(flag) ||
      values.has(flag) ||
      typeof value !== 'string' ||
      value.length === 0 ||
      value.startsWith('--')
    ) {
      return undefined;
    }
    values.set(flag, value);
  }
  const modeValue = values.get('--mode') ?? 'dry-run';
  if (modeValue !== 'dry-run' && modeValue !== 'execute') return undefined;
  const mode: LauncherMode =
    modeValue === 'execute' ? 'execute' : 'dry_run';
  const apiBaseUrl = values.get('--api-base-url');
  const identityFile = values.get('--identity-file');
  const artifactDirectory = values.get('--artifact-dir');
  const partnerTokenFile = values.get('--partner-token-file');
  const userTokenFile = values.get('--user-token-file');
  const planDigest = values.get('--plan-digest');
  if (
    apiBaseUrl !== YCLIENTS_API_DEFAULT_BASE_URL ||
    identityFile !== YCLIENTS_CONTROLLED_IDENTITY_FILE ||
    artifactDirectory !== YCLIENTS_CONTROLLED_ARTIFACT_DIRECTORY ||
    partnerTokenFile !== YCLIENTS_CONTROLLED_PARTNER_TOKEN_FILE ||
    userTokenFile !== YCLIENTS_CONTROLLED_USER_TOKEN_FILE ||
    (mode === 'execute' && planDigest !== YCLIENTS_CONTROLLED_PLAN_DIGEST) ||
    (mode === 'dry_run' && planDigest !== undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    mode,
    apiBaseUrl,
    identityFile,
    artifactDirectory,
    partnerTokenFile,
    userTokenFile,
    ...(planDigest === undefined ? {} : { planDigest }),
  });
}

function defaultDependencies(): YclientsControlledLauncherDependencies {
  return Object.freeze({
    effectiveUid: () =>
      typeof process.geteuid === 'function' ? process.geteuid() : undefined,
    createStore: (expectedUid: number) =>
      new YclientsControlledNodeRootOnlyFileStore(expectedUid),
    loadIdentity: loadYclientsControlledIdentity,
    fetch: globalThis.fetch,
    nowMilliseconds: () => Date.now(),
    sleep: (milliseconds: number) =>
      new Promise<void>((resolveSleep) =>
        setTimeout(() => resolveSleep(), milliseconds),
      ),
    writeOutput: (line: string) => {
      process.stdout.write(line);
    },
  });
}

async function writeSafeOutput(
  dependencies: YclientsControlledLauncherDependencies,
  value: unknown,
): Promise<boolean> {
  try {
    await dependencies.writeOutput(`${JSON.stringify(value)}\n`);
    return true;
  } catch {
    return false;
  }
}

export async function runYclientsControlledLauncher(
  argv: readonly string[],
  dependencies: YclientsControlledLauncherDependencies = defaultDependencies(),
): Promise<number> {
  const parsed = parseYclientsControlledLauncherArguments(argv);
  if (parsed === undefined) {
    await writeSafeOutput(dependencies, { outcome: 'invalid_arguments' });
    return 2;
  }
  const effectiveUid = dependencies.effectiveUid();
  if (effectiveUid !== 0) {
    await writeSafeOutput(dependencies, { outcome: 'owner_required' });
    return 2;
  }

  try {
    const store = dependencies.createStore(effectiveUid);
    const approvalPath = YCLIENTS_CONTROLLED_APPROVAL_FILE;
    const consumedPath = YCLIENTS_CONTROLLED_CONSUMED_APPROVAL_FILE;
    const bindingPath = YCLIENTS_CONTROLLED_BINDING_FILE;
    let expectedApprovalDigest: string | undefined;
    const approval = new YclientsControlledApprovalFileGate({
      approvalPath,
      consumedPath,
      store,
      expectedApprovalDigest: () => expectedApprovalDigest,
    });
    const bindings = new YclientsControlledBindingArtifactFileSink({
      bindingPath,
      store,
    });
    if (
      approval.persistence !== 'cross_process' ||
      bindings.persistence !== 'root_only_exclusive'
    ) {
      throw new TypeError('Invalid controlled persistent gates');
    }
    await store.read(YCLIENTS_CONTROLLED_OWNER_CHECK_FILE, 0);
    const consumedArtifact = await store.read(consumedPath, 65);
    const bindingArtifact = await store.read(bindingPath, 256);
    const approvalArtifact = await store.read(approvalPath, 65);
    if (
      consumedArtifact !== undefined ||
      bindingArtifact !== undefined ||
      (parsed.mode === 'dry_run' && approvalArtifact !== undefined)
    ) {
      throw new TypeError('Controlled artifacts are not clean');
    }
    const identity = await dependencies.loadIdentity(
      store,
      parsed.identityFile,
    );
    const plan = buildYclientsControlledOperationalPlan(identity);
    const partnerToken = await loadYclientsControlledRootOnlySecret(
      store,
      parsed.partnerTokenFile,
    );
    const userToken = await loadYclientsControlledRootOnlySecret(
      store,
      parsed.userTokenFile,
    );
    expectedApprovalDigest = createYclientsControlledExecutionApprovalDigest(
      identity,
      YCLIENTS_CONTROLLED_PLAN_DIGEST,
      partnerToken,
      userToken,
    );
    if (
      parsed.mode === 'execute' &&
      approvalArtifact !== undefined &&
      (!/^[a-f0-9]{64}\n?$/u.test(approvalArtifact) ||
        approvalArtifact.replace(/\n$/u, '') !== expectedApprovalDigest)
    ) {
      throw new TypeError('Controlled identity approval mismatch');
    }
    const runner = createYclientsControlledExecutableRunner({
      baseUrl: parsed.apiBaseUrl,
      companyId: plan.companyId,
      partnerToken,
      userToken,
      requestTimeoutMilliseconds: 10_000,
      fetch: dependencies.fetch,
      clock: {
        nowMilliseconds: dependencies.nowMilliseconds,
        sleep: dependencies.sleep,
      },
      evidence: {
        record: async (event: YclientsControlledEvidenceEvent) => {
          if (
            !(await writeSafeOutput(dependencies, {
              kind: 'provider_evidence',
              event,
            }))
          ) {
            throw new TypeError('Controlled evidence unavailable');
          }
        },
      },
      identity,
      approval,
      bindings,
    });
    const result = await runner.run(
      plan,
      parsed.mode === 'execute'
        ? Object.freeze({
            mode: 'execute' as const,
            planDigest: parsed.planDigest as string,
          })
        : Object.freeze({ mode: 'dry_run' as const }),
    );
    const safeResult =
      result.outcome === 'dry_run_ready'
        ? Object.freeze({ ...result, approvalDigest: expectedApprovalDigest })
        : result;
    if (!(await writeSafeOutput(dependencies, safeResult))) return 2;
    if (result.outcome === 'dry_run_ready') return 0;
    if (
      result.outcome === 'executed' &&
      result.lifecycle.outcome === 'passed'
    ) {
      return 0;
    }
    return 2;
  } catch {
    await writeSafeOutput(dependencies, { outcome: 'configuration_rejected' });
    return 2;
  }
}

if (require.main === module) {
  void runYclientsControlledLauncher(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      process.exitCode = 2;
    },
  );
}

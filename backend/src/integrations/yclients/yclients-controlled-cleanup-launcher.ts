import { YCLIENTS_API_DEFAULT_BASE_URL } from '../../config/yclients-api.config';
import {
  YclientsControlledApprovalFileGate,
  YclientsControlledNodeRootOnlyFileStore,
  YclientsControlledRootOnlyFileStore,
} from './yclients-controlled-artifacts';
import { createYclientsControlledCleanupExecutableRunner } from './yclients-controlled-cleanup-executable';
import type { YclientsControlledCleanupEvidenceEvent } from './yclients-controlled-cleanup-lifecycle';
import {
  buildYclientsControlledCleanupOperationalPlan,
  YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
} from './yclients-controlled-cleanup-operational-plan';
import {
  createYclientsControlledExecutionApprovalDigest,
  loadYclientsControlledIdentity,
  loadYclientsControlledRootOnlySecret,
  YclientsControlledLoadedIdentity,
} from './yclients-controlled-operational-plan';
import {
  YCLIENTS_CONTROLLED_BINDING_FILE,
  YCLIENTS_CONTROLLED_IDENTITY_FILE,
  YCLIENTS_CONTROLLED_PARTNER_TOKEN_FILE,
  YCLIENTS_CONTROLLED_USER_TOKEN_FILE,
} from './yclients-controlled-launcher';

export const YCLIENTS_CONTROLLED_CLEANUP_ROOT =
  '/root/prosto-padel-d2-cleanup-1891713981';
export const YCLIENTS_CONTROLLED_CLEANUP_ARTIFACT_DIRECTORY =
  `${YCLIENTS_CONTROLLED_CLEANUP_ROOT}/artifacts`;
export const YCLIENTS_CONTROLLED_CLEANUP_APPROVAL_FILE =
  `${YCLIENTS_CONTROLLED_CLEANUP_ARTIFACT_DIRECTORY}/approval.sha256`;
export const YCLIENTS_CONTROLLED_CLEANUP_CONSUMED_FILE =
  `${YCLIENTS_CONTROLLED_CLEANUP_ARTIFACT_DIRECTORY}/approval.sha256.consumed`;
export const YCLIENTS_CONTROLLED_CLEANUP_OWNER_CHECK_FILE =
  `${YCLIENTS_CONTROLLED_CLEANUP_ARTIFACT_DIRECTORY}/.owner-check`;

const EXPECTED_SOURCE_BINDING =
  '{"version":1,"slot":"A","appointmentId":1,"recordId":1891713981}\n';

type LauncherMode = 'dry_run' | 'execute';

export type YclientsControlledCleanupLauncherArguments = Readonly<{
  mode: LauncherMode;
  apiBaseUrl: string;
  identityFile: string;
  sourceBindingFile: string;
  artifactDirectory: string;
  partnerTokenFile: string;
  userTokenFile: string;
  planDigest?: string;
}>;

export type YclientsControlledCleanupLauncherDependencies = Readonly<{
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
  '--source-binding-file',
  '--artifact-dir',
  '--partner-token-file',
  '--user-token-file',
  '--plan-digest',
]);

export function parseYclientsControlledCleanupLauncherArguments(
  argv: readonly string[],
): YclientsControlledCleanupLauncherArguments | undefined {
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
  const sourceBindingFile = values.get('--source-binding-file');
  const artifactDirectory = values.get('--artifact-dir');
  const partnerTokenFile = values.get('--partner-token-file');
  const userTokenFile = values.get('--user-token-file');
  const planDigest = values.get('--plan-digest');
  if (
    apiBaseUrl !== YCLIENTS_API_DEFAULT_BASE_URL ||
    identityFile !== YCLIENTS_CONTROLLED_IDENTITY_FILE ||
    sourceBindingFile !== YCLIENTS_CONTROLLED_BINDING_FILE ||
    artifactDirectory !== YCLIENTS_CONTROLLED_CLEANUP_ARTIFACT_DIRECTORY ||
    partnerTokenFile !== YCLIENTS_CONTROLLED_PARTNER_TOKEN_FILE ||
    userTokenFile !== YCLIENTS_CONTROLLED_USER_TOKEN_FILE ||
    (mode === 'execute' &&
      planDigest !== YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST) ||
    (mode === 'dry_run' && planDigest !== undefined)
  ) {
    return undefined;
  }
  return Object.freeze({
    mode,
    apiBaseUrl,
    identityFile,
    sourceBindingFile,
    artifactDirectory,
    partnerTokenFile,
    userTokenFile,
    ...(planDigest === undefined ? {} : { planDigest }),
  });
}

function defaultDependencies(): YclientsControlledCleanupLauncherDependencies {
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
  dependencies: YclientsControlledCleanupLauncherDependencies,
  value: unknown,
): Promise<boolean> {
  try {
    await dependencies.writeOutput(`${JSON.stringify(value)}\n`);
    return true;
  } catch {
    return false;
  }
}

export async function runYclientsControlledCleanupLauncher(
  argv: readonly string[],
  dependencies: YclientsControlledCleanupLauncherDependencies =
    defaultDependencies(),
): Promise<number> {
  const parsed = parseYclientsControlledCleanupLauncherArguments(argv);
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
    await store.read(YCLIENTS_CONTROLLED_CLEANUP_OWNER_CHECK_FILE, 0);
    const consumedArtifact = await store.read(
      YCLIENTS_CONTROLLED_CLEANUP_CONSUMED_FILE,
      65,
    );
    const approvalArtifact = await store.read(
      YCLIENTS_CONTROLLED_CLEANUP_APPROVAL_FILE,
      65,
    );
    const sourceBinding = await store.read(parsed.sourceBindingFile, 256);
    if (
      consumedArtifact !== undefined ||
      sourceBinding !== EXPECTED_SOURCE_BINDING ||
      (parsed.mode === 'dry_run' && approvalArtifact !== undefined)
    ) {
      throw new TypeError('Controlled cleanup artifacts are not clean');
    }
    const identity = await dependencies.loadIdentity(
      store,
      parsed.identityFile,
    );
    const plan = buildYclientsControlledCleanupOperationalPlan(identity);
    const partnerToken = await loadYclientsControlledRootOnlySecret(
      store,
      parsed.partnerTokenFile,
    );
    const userToken = await loadYclientsControlledRootOnlySecret(
      store,
      parsed.userTokenFile,
    );
    const expectedApprovalDigest =
      createYclientsControlledExecutionApprovalDigest(
        identity,
        YCLIENTS_CONTROLLED_CLEANUP_PLAN_DIGEST,
        partnerToken,
        userToken,
      );
    if (
      parsed.mode === 'execute' &&
      approvalArtifact !== undefined &&
      (!/^[a-f0-9]{64}\n?$/u.test(approvalArtifact) ||
        approvalArtifact.replace(/\n$/u, '') !== expectedApprovalDigest)
    ) {
      throw new TypeError('Controlled cleanup identity approval mismatch');
    }
    const approval = new YclientsControlledApprovalFileGate({
      approvalPath: YCLIENTS_CONTROLLED_CLEANUP_APPROVAL_FILE,
      consumedPath: YCLIENTS_CONTROLLED_CLEANUP_CONSUMED_FILE,
      store,
      expectedApprovalDigest,
    });
    const runner = createYclientsControlledCleanupExecutableRunner({
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
        record: async (event: YclientsControlledCleanupEvidenceEvent) => {
          if (
            !(await writeSafeOutput(dependencies, {
              kind: 'cleanup_provider_evidence',
              event,
            }))
          ) {
            throw new TypeError('Controlled cleanup evidence unavailable');
          }
        },
      },
      identity,
      approval,
      sourceBindingVerified: true,
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
      (result.lifecycle.outcome === 'cancelled_confirmed' ||
        result.lifecycle.outcome ===
          'cancelled_confirmed_after_uncertain_response')
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
  void runYclientsControlledCleanupLauncher(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      process.exitCode = 2;
    },
  );
}

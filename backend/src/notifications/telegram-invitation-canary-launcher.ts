import { isAccountId } from '../accounts/account.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  TelegramInvitationCanary,
  TelegramInvitationCanaryTarget,
} from './telegram-invitation-canary';

const RELEASE_PATTERN = /^[0-9a-f]{40}$/u;
const EXECUTION_APPROVAL = 'SEND_ONE_MATCH_INVITATION';
export const TELEGRAM_INVITATION_CANARY_MINI_APP_URL =
  'https://test-app.prostopdl.ru/';
const VALUE_FLAGS = new Set([
  '--mode',
  '--event-key',
  '--recipient-account-id',
  '--expected-release',
  '--mini-app-url',
  '--approval',
]);

type TelegramInvitationCanaryLauncherArguments = Readonly<{
  target: TelegramInvitationCanaryTarget;
  expectedRelease: string;
}>;

type TelegramInvitationCanaryRuntime = Readonly<{
  nodeEnvironment: string;
  release: string;
  releaseShaRequired: boolean;
  databaseEnabled: boolean;
  telegramAuthEnabled: boolean;
  outboundNotificationsEnabled: boolean;
  yclientsNotificationReconciliationEnabled: boolean;
  botTokenReady: boolean;
  miniAppUrlReady: boolean;
}>;

export type TelegramInvitationCanaryLauncherDependencies = Readonly<{
  load(): Promise<
    Readonly<{
      runtime: TelegramInvitationCanaryRuntime;
      canary: Pick<TelegramInvitationCanary, 'run'>;
      close(): Promise<void>;
    }>
  >;
  writeOutput(line: string): void | Promise<void>;
}>;

export function parseTelegramInvitationCanaryArguments(
  argv: readonly string[],
): TelegramInvitationCanaryLauncherArguments | undefined {
  if (argv.length !== VALUE_FLAGS.size * 2) return undefined;
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

  const eventKey = values.get('--event-key');
  const recipientAccountId = values.get('--recipient-account-id');
  const expectedRelease = values.get('--expected-release');
  if (
    values.get('--mode') !== 'execute' ||
    values.get('--approval') !== EXECUTION_APPROVAL ||
    values.get('--mini-app-url') !== TELEGRAM_INVITATION_CANARY_MINI_APP_URL ||
    typeof eventKey !== 'string' ||
    !eventKey.startsWith('match_invited:') ||
    !isInternalUuid(eventKey.slice('match_invited:'.length)) ||
    !isAccountId(recipientAccountId) ||
    typeof expectedRelease !== 'string' ||
    !RELEASE_PATTERN.test(expectedRelease)
  ) {
    return undefined;
  }
  return Object.freeze({
    target: Object.freeze({ eventKey, recipientAccountId }),
    expectedRelease,
  });
}

function runtimeIsSafe(
  runtime: TelegramInvitationCanaryRuntime,
  expectedRelease: string,
): boolean {
  return (
    runtime.nodeEnvironment === 'test' &&
    runtime.release === expectedRelease &&
    runtime.releaseShaRequired &&
    runtime.databaseEnabled &&
    runtime.telegramAuthEnabled &&
    !runtime.outboundNotificationsEnabled &&
    !runtime.yclientsNotificationReconciliationEnabled &&
    runtime.botTokenReady &&
    runtime.miniAppUrlReady
  );
}

async function safeOutput(
  dependencies: TelegramInvitationCanaryLauncherDependencies,
  outcome: string,
): Promise<void> {
  await dependencies.writeOutput(`${JSON.stringify({ outcome })}\n`);
}

export async function runTelegramInvitationCanaryLauncher(
  argv: readonly string[],
  dependencies: TelegramInvitationCanaryLauncherDependencies,
): Promise<number> {
  const parsed = parseTelegramInvitationCanaryArguments(argv);
  if (parsed === undefined) {
    await safeOutput(dependencies, 'invalid_arguments');
    return 2;
  }

  let loaded:
    | Awaited<ReturnType<TelegramInvitationCanaryLauncherDependencies['load']>>
    | undefined;
  try {
    loaded = await dependencies.load();
    if (!runtimeIsSafe(loaded.runtime, parsed.expectedRelease)) {
      await safeOutput(dependencies, 'runtime_rejected');
      return 2;
    }
    const result = await loaded.canary.run(parsed.target);
    await safeOutput(dependencies, result.outcome);
    return result.outcome === 'sent' ? 0 : 2;
  } catch {
    await safeOutput(dependencies, 'execution_rejected');
    return 2;
  } finally {
    await loaded?.close().catch(() => undefined);
  }
}

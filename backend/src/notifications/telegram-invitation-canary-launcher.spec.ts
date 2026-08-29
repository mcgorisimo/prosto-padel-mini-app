import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  parseTelegramInvitationCanaryArguments,
  runTelegramInvitationCanaryLauncher,
  TELEGRAM_INVITATION_CANARY_MINI_APP_URL,
  TelegramInvitationCanaryLauncherDependencies,
} from './telegram-invitation-canary-launcher';

type TelegramInvitationCanaryRuntime = Awaited<
  ReturnType<TelegramInvitationCanaryLauncherDependencies['load']>
>['runtime'];

const EVENT_KEY = `match_invited:${deterministicUuid('launcher-invitation')}`;
const RECIPIENT = deterministicUuid('launcher-recipient');
const RELEASE = 'a'.repeat(40);
const ARGS = [
  '--mode',
  'execute',
  '--event-key',
  EVENT_KEY,
  '--recipient-account-id',
  RECIPIENT,
  '--expected-release',
  RELEASE,
  '--mini-app-url',
  TELEGRAM_INVITATION_CANARY_MINI_APP_URL,
  '--approval',
  'SEND_ONE_MATCH_INVITATION',
] as const;

function safeRuntime(
  override: Partial<TelegramInvitationCanaryRuntime> = {},
): TelegramInvitationCanaryRuntime {
  return Object.freeze({
    nodeEnvironment: 'test',
    release: RELEASE,
    releaseShaRequired: true,
    databaseEnabled: true,
    telegramAuthEnabled: true,
    outboundNotificationsEnabled: false,
    yclientsNotificationReconciliationEnabled: false,
    botTokenReady: true,
    miniAppUrlReady: true,
    ...override,
  });
}

function harness(
  runtime: TelegramInvitationCanaryRuntime = safeRuntime(),
  outcome = 'sent',
) {
  const run = jest.fn().mockResolvedValue({ outcome });
  const close = jest.fn().mockResolvedValue(undefined);
  const writeOutput = jest.fn();
  const load = jest.fn().mockResolvedValue({
    runtime,
    canary: { run },
    close,
  });
  const dependencies: TelegramInvitationCanaryLauncherDependencies = {
    load,
    writeOutput,
  };
  return { dependencies, load, run, close, writeOutput };
}

describe('Telegram invitation canary launcher', () => {
  it('requires exact execution arguments and a one-send approval phrase', () => {
    expect(parseTelegramInvitationCanaryArguments(ARGS)).toEqual({
      target: { eventKey: EVENT_KEY, recipientAccountId: RECIPIENT },
      expectedRelease: RELEASE,
    });
    expect(
      parseTelegramInvitationCanaryArguments(
        ARGS.map((value) =>
          value === 'SEND_ONE_MATCH_INVITATION' ? 'send' : value,
        ),
      ),
    ).toBeUndefined();
    expect(
      parseTelegramInvitationCanaryArguments([...ARGS, '--extra', 'value']),
    ).toBeUndefined();
    expect(
      parseTelegramInvitationCanaryArguments(
        ARGS.map((value) =>
          value === TELEGRAM_INVITATION_CANARY_MINI_APP_URL
            ? 'https://app.prostopdl.ru/'
            : value,
        ),
      ),
    ).toBeUndefined();
  });

  it('does not initialize runtime for invalid arguments', async () => {
    const h = harness();
    await expect(
      runTelegramInvitationCanaryLauncher([], h.dependencies),
    ).resolves.toBe(2);
    expect(h.load).not.toHaveBeenCalled();
    expect(h.writeOutput).toHaveBeenCalledWith(
      `${JSON.stringify({ outcome: 'invalid_arguments' })}\n`,
    );
  });

  it.each([
    { nodeEnvironment: 'production' },
    { release: 'b'.repeat(40) },
    { releaseShaRequired: false },
    { databaseEnabled: false },
    { telegramAuthEnabled: false },
    { outboundNotificationsEnabled: true },
    { yclientsNotificationReconciliationEnabled: true },
    { botTokenReady: false },
    { miniAppUrlReady: false },
  ] as const)('fails closed for unsafe runtime %#', async (override) => {
    const h = harness(safeRuntime(override));
    await expect(
      runTelegramInvitationCanaryLauncher(ARGS, h.dependencies),
    ).resolves.toBe(2);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it('executes one exact target and emits no identity', async () => {
    const h = harness();
    await expect(
      runTelegramInvitationCanaryLauncher(ARGS, h.dependencies),
    ).resolves.toBe(0);
    expect(h.run).toHaveBeenCalledWith({
      eventKey: EVENT_KEY,
      recipientAccountId: RECIPIENT,
    });
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.writeOutput).toHaveBeenCalledWith(
      `${JSON.stringify({ outcome: 'sent' })}\n`,
    );
    expect(JSON.stringify(h.writeOutput.mock.calls)).not.toContain(RECIPIENT);
  });
});

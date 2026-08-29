// @vitest-environment jsdom

import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import MatchDetailsScreen from '../../src/components/MatchDetailsScreen';
import { createBackendSessionClient } from '../../src/lib/backendSessionClient';

const POLL_INTERVAL_MS = 5_000;
const CREDENTIAL = 'A'.repeat(43);
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const THIRD_ACCOUNT_ID = '33333333-3333-4333-8333-333333333334';
const FOURTH_ACCOUNT_ID = '44444444-4444-4444-8444-444444444445';
const MATCH_ID = '33333333-3333-4333-8333-333333333333';
const WAITLIST_ID = '55555555-5555-4555-8555-555555555555';

let visibilityState = 'visible';

function createDeferredProbe(resolvedValue) {
  let mode = 'resolved';
  let active = 0;
  let maximumActive = 0;
  let pending = [];

  const invoke = vi.fn(() => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);

    if (mode === 'slow') {
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    }

    active -= 1;
    if (mode === 'rejected') {
      return Promise.reject(new Error('synthetic_503'));
    }
    return Promise.resolve(resolvedValue);
  });

  return {
    invoke,
    get calls() {
      return invoke.mock.calls.length;
    },
    get active() {
      return active;
    },
    get maximumActive() {
      return maximumActive;
    },
    setSlow() {
      mode = 'slow';
    },
    setRejected() {
      mode = 'rejected';
    },
    resolveAll(value = resolvedValue) {
      const queued = pending;
      pending = [];
      queued.forEach(({ resolve }) => {
        active -= 1;
        resolve(value);
      });
    },
    rejectAll() {
      const queued = pending;
      pending = [];
      queued.forEach(({ reject }) => {
        active -= 1;
        reject(new Error('synthetic_503'));
      });
    },
  };
}

function streamingJsonResponse(status, payload) {
  const bytes = Uint8Array.from(JSON.stringify(payload), (character) =>
    character.charCodeAt(0),
  );
  let consumed = false;
  return {
    status,
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          async read() {
            if (consumed) return { done: true, value: undefined };
            consumed = true;
            return { done: false, value: bytes };
          },
          cancel: async () => {},
          releaseLock() {},
        };
      },
    },
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advancePoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
  });
  await flushEffects();
}

async function setVisibility(nextState) {
  visibilityState = nextState;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await flushEffects();
}

function player(id, slotIndex, firstName = 'Player') {
  return {
    id,
    firstName,
    lastName: String(slotIndex + 1),
    rating: 3,
    numericRating: 3,
    ratingIdx: 2,
    isVerified: true,
    isOrganizer: slotIndex === 0,
    slotIndex,
  };
}

function createMatch({ participant = true, full = false } = {}) {
  const filledSlots = full
    ? [
        player(OTHER_ACCOUNT_ID, 0, 'Owner'),
        player(THIRD_ACCOUNT_ID, 1),
        player(FOURTH_ACCOUNT_ID, 2),
        player('66666666-6666-4666-8666-666666666666', 3),
      ]
    : [
        player(OTHER_ACCOUNT_ID, 0, 'Owner'),
        ...(participant ? [player(ACCOUNT_ID, 1, 'Current')] : []),
      ];

  return {
    id: MATCH_ID,
    backendOwned: true,
    ownerId: OTHER_ACCOUNT_ID,
    owner_id: OTHER_ACCOUNT_ID,
    title: 'Request budget match',
    description: '',
    date: '1 января',
    dateISO: '2030-01-01',
    time: '10:00',
    startsAt: 1_893_488_400,
    duration: 1.5,
    durationMinutes: 90,
    courtName: 'Корт 1',
    courtType: 'panoramic',
    type: 'match',
    scenario: 'social',
    status: 'upcoming',
    isPrivate: false,
    isRatingMatch: false,
    ratingMin: 0,
    ratingMax: 6,
    participants: filledSlots.map(({ id }) => id),
    filledSlots,
  };
}

function currentUser() {
  return {
    ...player(ACCOUNT_ID, 1, 'Current'),
    role: 'user',
  };
}

function baseDetailProps(match) {
  return {
    match,
    currentUser: currentUser(),
    onBack() {},
    onJoinSuccess() {},
    onDelete() {},
    onComplete() {},
    onConfirmScore() {},
    onDisputeScore() {},
    onSlotsChange() {},
    onJoinMatch() {},
    onLeaveMatch() {},
    pendingInvitations: [],
    invitationActions: new Set(),
    allMessages: [],
    messagesLoading: false,
    messagesLoadError: '',
    showToast() {},
  };
}

function renderNotificationProbe(probe, overrides = {}) {
  const actions = {
    listMatches: vi.fn(async () => ({
      outcome: 'matches_loaded',
      matches: [],
    })),
    listAccountMatches: vi.fn(async () => ({
      outcome: 'matches_loaded',
      matches: [],
    })),
    listIncomingMatchInvitations: vi.fn(async () => ({
      outcome: 'invitations_loaded',
      invitations: [],
    })),
    listMatchNotifications: probe.invoke,
    ...overrides,
  };
  const onBackendProfileRefresh = vi.fn(async () => null);

  const view = render(
    <App
      backendProfile={{
        accountId: ACCOUNT_ID,
        role: 'player',
        firstName: 'Current',
        lastName: 'Player',
        username: 'current_player',
        photoUrl: null,
        languageCode: 'ru',
        phone: null,
        sidePreference: null,
        rating: 3,
        isVerified: true,
        capabilities: [],
      }}
      backendMatchLifecycleStatus="authenticated"
      backendProfileStatus="ready"
      backendMatchActions={actions}
      onBackendProfileRefresh={onBackendProfileRefresh}
      showToast={() => {}}
      onLogout={() => {}}
    />,
  );

  return { actions, onBackendProfileRefresh, view };
}

function renderChatProbe(probe) {
  const match = createMatch();
  const view = render(
    <MatchDetailsScreen
      {...baseDetailProps(match)}
      onRetryMessages={() => Promise.resolve()}
      onRefreshMessages={probe.invoke}
      onSendMessage={() => Promise.resolve()}
    />,
  );
  fireEvent.click(view.getByTestId('match-chat-open-button'));
  return view;
}

function waitlistResult() {
  const entry = {
    entryId: WAITLIST_ID,
    player: {
      playerId: ACCOUNT_ID,
      firstName: 'Current',
      lastName: 'Player',
      username: 'current_player',
      rating: 3,
      isVerified: true,
    },
    queuePosition: 1,
    joinedAt: 1_893_000_000,
    isCurrentPlayer: true,
  };
  return {
    outcome: 'waitlist_loaded',
    entries: [entry],
    current: entry,
    count: 1,
  };
}

function renderWaitlistProbe(waitlistProbe, detailProbe) {
  const match = createMatch({ participant: false, full: true });
  return render(
    <MatchDetailsScreen
      {...baseDetailProps(match)}
      onLoadWaitlist={waitlistProbe.invoke}
      onJoinWaitlist={() => Promise.resolve()}
      onLeaveWaitlist={() => Promise.resolve()}
      onRefreshMatch={detailProbe.invoke}
    />,
  );
}

function lineupResult() {
  const players = [
    player(OTHER_ACCOUNT_ID, 0, 'Owner'),
    player(ACCOUNT_ID, 1, 'Current'),
  ];
  return {
    outcome: 'lineup_loaded',
    lineup: {
      matchId: MATCH_ID,
      status: 'draft',
      version: 1,
      slots: [
        [1, 'left'],
        [1, 'right'],
        [2, 'left'],
        [2, 'right'],
      ].map(([teamNumber, courtSide], index) => ({
        teamNumber,
        courtSide,
        ...(players[index]
          ? {
              assignment: {
                assignmentId: `77777777-7777-4777-8777-77777777777${index}`,
                player: {
                  playerId: players[index].id,
                  firstName: players[index].firstName,
                  lastName: players[index].lastName,
                  rating: 3,
                  isVerified: true,
                },
                assignedAt: 1_893_000_000 + index,
                isCurrentPlayer: players[index].id === ACCOUNT_ID,
              },
            }
          : {}),
      })),
      unassignedPlayers: [],
    },
  };
}

function renderLineupProbe(probe) {
  const match = createMatch();
  return render(
    <MatchDetailsScreen
      {...baseDetailProps(match)}
      onLoadLineup={probe.invoke}
      onAssignLineupSlot={() => Promise.resolve()}
      onReleaseLineupSlot={() => Promise.resolve()}
    />,
  );
}

function renderResultProbe(probe) {
  const match = createMatch();
  return render(
    <MatchDetailsScreen
      {...baseDetailProps(match)}
      onLoadResult={probe.invoke}
      onSubmitResult={() => Promise.resolve()}
      onConfirmResult={() => Promise.resolve()}
      onDisputeResult={() => Promise.resolve()}
    />,
  );
}

beforeEach(() => {
  visibilityState = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibilityState,
  });
});

describe('D6.2 frontend request-budget target harness', () => {
  it('polls notifications exactly once per active tick', async () => {
    vi.useFakeTimers();
    const probe = createDeferredProbe({
      outcome: 'notifications_loaded',
      notifications: [],
      unreadCount: 0,
    });
    renderNotificationProbe(probe);
    await flushEffects();

    const initialCalls = probe.calls;
    await advancePoll();
    expect(probe.calls).toBe(initialCalls + 1);
  });

  it('pauses notifications while hidden', async () => {
    vi.useFakeTimers();
    const probe = createDeferredProbe({
      outcome: 'notifications_loaded',
      notifications: [],
      unreadCount: 0,
    });
    renderNotificationProbe(probe);
    await flushEffects();

    await setVisibility('hidden');
    const hiddenBaseline = probe.calls;
    await advancePoll();
    expect(probe.calls).toBe(hiddenBaseline);
  });

  it('keeps notifications single-flight when one poll is slow', async () => {
    vi.useFakeTimers();
    const probe = createDeferredProbe({
      outcome: 'notifications_loaded',
      notifications: [],
      unreadCount: 0,
    });
    renderNotificationProbe(probe);
    await flushEffects();
    probe.setSlow();

    const baseline = probe.calls;
    await advancePoll();
    await advancePoll();
    expect(probe.calls).toBe(baseline + 1);
    expect(probe.maximumActive).toBe(1);

    probe.resolveAll();
    await flushEffects();
  });

  it('refreshes notifications exactly once after visible resume', async () => {
    vi.useFakeTimers();
    const probe = createDeferredProbe({
      outcome: 'notifications_loaded',
      notifications: [],
      unreadCount: 0,
    });
    renderNotificationProbe(probe);
    await flushEffects();

    const baseline = probe.calls;
    await setVisibility('hidden');
    await setVisibility('visible');
    expect(probe.calls).toBe(baseline + 1);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flushEffects();
    expect(probe.calls).toBe(baseline + 1);
  });

  it('polls chat exactly once per active tick', async () => {
    vi.useFakeTimers();
    const probe = createDeferredProbe(undefined);
    renderChatProbe(probe);
    await flushEffects();

    await advancePoll();
    expect(probe.calls).toBe(1);
  });

  it.fails('pauses chat while hidden', async () => {
    vi.useFakeTimers();
    const probe = createDeferredProbe(undefined);
    renderChatProbe(probe);
    await flushEffects();

    await setVisibility('hidden');
    const hiddenBaseline = probe.calls;
    await advancePoll();
    expect(probe.calls).toBe(hiddenBaseline);
  });

  it.fails(
    'keeps chat refresh single-flight when one poll is slow',
    async () => {
      vi.useFakeTimers();
      const probe = createDeferredProbe(undefined);
      renderChatProbe(probe);
      await flushEffects();
      probe.setSlow();

      await advancePoll();
      await advancePoll();
      expect(probe.calls).toBe(1);
      expect(probe.maximumActive).toBe(1);

      probe.resolveAll();
      await flushEffects();
    },
  );

  it.fails('pauses the waitlist detail pair while hidden', async () => {
    vi.useFakeTimers();
    const waitlistProbe = createDeferredProbe(waitlistResult());
    const detailProbe = createDeferredProbe(
      createMatch({
        participant: false,
        full: true,
      }),
    );
    renderWaitlistProbe(waitlistProbe, detailProbe);
    await flushEffects();

    const waitlistInitial = waitlistProbe.calls;
    const detailInitial = detailProbe.calls;
    await advancePoll();
    expect(waitlistProbe.calls).toBe(waitlistInitial + 1);
    expect(detailProbe.calls).toBe(detailInitial + 1);

    await setVisibility('hidden');
    const hiddenWaitlist = waitlistProbe.calls;
    const hiddenDetail = detailProbe.calls;
    await advancePoll();
    expect(waitlistProbe.calls).toBe(hiddenWaitlist);
    expect(detailProbe.calls).toBe(hiddenDetail);
  });

  it('keeps the waitlist detail pair single-flight when it is slow', async () => {
    vi.useFakeTimers();
    const waitlistProbe = createDeferredProbe(waitlistResult());
    const detailProbe = createDeferredProbe(
      createMatch({
        participant: false,
        full: true,
      }),
    );
    renderWaitlistProbe(waitlistProbe, detailProbe);
    await flushEffects();
    waitlistProbe.setSlow();
    detailProbe.setSlow();

    const waitlistBaseline = waitlistProbe.calls;
    const detailBaseline = detailProbe.calls;
    await advancePoll();
    await advancePoll();
    expect(waitlistProbe.calls).toBe(waitlistBaseline + 1);
    expect(detailProbe.calls).toBe(detailBaseline + 1);
    expect(waitlistProbe.maximumActive).toBe(1);
    expect(detailProbe.maximumActive).toBe(1);

    waitlistProbe.resolveAll();
    detailProbe.resolveAll();
    await flushEffects();
  });

  it.fails('pauses lineup polling while hidden', async () => {
    vi.useFakeTimers();
    const probe = createDeferredProbe(lineupResult());
    renderLineupProbe(probe);
    await flushEffects();

    const initialCalls = probe.calls;
    await advancePoll();
    expect(probe.calls).toBe(initialCalls + 1);

    await setVisibility('hidden');
    const hiddenBaseline = probe.calls;
    await advancePoll();
    expect(probe.calls).toBe(hiddenBaseline);
  });

  it('keeps lineup polling single-flight when it is slow', async () => {
    vi.useFakeTimers();
    const probe = createDeferredProbe(lineupResult());
    renderLineupProbe(probe);
    await flushEffects();
    probe.setSlow();

    const baseline = probe.calls;
    await advancePoll();
    await advancePoll();
    expect(probe.calls).toBe(baseline + 1);
    expect(probe.maximumActive).toBe(1);

    probe.resolveAll();
    await flushEffects();
  });

  it.fails('pauses result polling while hidden', async () => {
    vi.useFakeTimers();
    const probe = createDeferredProbe({
      outcome: 'rejected',
      reason: 'result_not_found',
    });
    renderResultProbe(probe);
    await flushEffects();

    const initialCalls = probe.calls;
    await advancePoll();
    expect(probe.calls).toBe(initialCalls + 1);

    await setVisibility('hidden');
    const hiddenBaseline = probe.calls;
    await advancePoll();
    expect(probe.calls).toBe(hiddenBaseline);
  });

  it('keeps result polling single-flight when it is slow', async () => {
    vi.useFakeTimers();
    const probe = createDeferredProbe({
      outcome: 'rejected',
      reason: 'result_not_found',
    });
    renderResultProbe(probe);
    await flushEffects();
    probe.setSlow();

    const baseline = probe.calls;
    await advancePoll();
    await advancePoll();
    expect(probe.calls).toBe(baseline + 1);
    expect(probe.maximumActive).toBe(1);

    probe.resolveAll();
    await flushEffects();
  });

  it.fails(
    'coalesces focus and visible-resume into one account refresh',
    async () => {
      const notificationProbe = createDeferredProbe({
        outcome: 'notifications_loaded',
        notifications: [],
        unreadCount: 0,
      });
      const { actions, onBackendProfileRefresh } =
        renderNotificationProbe(notificationProbe);
      await flushEffects();

      const baseline = {
        feed: actions.listMatches.mock.calls.length,
        mine: actions.listAccountMatches.mock.calls.length,
        invitations: actions.listIncomingMatchInvitations.mock.calls.length,
        profile: onBackendProfileRefresh.mock.calls.length,
      };
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await flushEffects();

      expect(actions.listMatches).toHaveBeenCalledTimes(baseline.feed + 1);
      expect(actions.listAccountMatches).toHaveBeenCalledTimes(
        baseline.mine + 1,
      );
      expect(actions.listIncomingMatchInvitations).toHaveBeenCalledTimes(
        baseline.invitations + 1,
      );
      expect(onBackendProfileRefresh).toHaveBeenCalledTimes(
        baseline.profile + 1,
      );
    },
  );

  it.fails(
    'runs exactly one immediate refresh per remaining poller after visible resume',
    async () => {
      vi.useFakeTimers();
      const chatProbe = createDeferredProbe(undefined);
      const waitlistProbe = createDeferredProbe(waitlistResult());
      const detailProbe = createDeferredProbe(
        createMatch({
          participant: false,
          full: true,
        }),
      );
      const lineupProbe = createDeferredProbe(lineupResult());
      const resultProbe = createDeferredProbe({
        outcome: 'rejected',
        reason: 'result_not_found',
      });
      renderChatProbe(chatProbe);
      renderWaitlistProbe(waitlistProbe, detailProbe);
      renderLineupProbe(lineupProbe);
      renderResultProbe(resultProbe);
      await flushEffects();

      const baseline = {
        chat: chatProbe.calls,
        waitlist: waitlistProbe.calls,
        detail: detailProbe.calls,
        lineup: lineupProbe.calls,
        result: resultProbe.calls,
      };
      await setVisibility('hidden');
      await setVisibility('visible');

      expect({
        chat: chatProbe.calls - baseline.chat,
        waitlist: waitlistProbe.calls - baseline.waitlist,
        detail: detailProbe.calls - baseline.detail,
        lineup: lineupProbe.calls - baseline.lineup,
        result: resultProbe.calls - baseline.result,
      }).toEqual({
        chat: 1,
        waitlist: 1,
        detail: 1,
        lineup: 1,
        result: 1,
      });
    },
  );

  it('caps every backend read at three physical attempts after 503', async () => {
    const attempts = [];
    const client = createBackendSessionClient({
      fetchImpl: async (url) => {
        attempts.push(url);
        const code = url.includes('/messages')
          ? 'match_chat_service_unavailable'
          : url.includes('/waitlist')
            ? 'match_waitlist_service_unavailable'
            : url.includes('/lineup')
              ? 'match_lineup_service_unavailable'
              : url.includes('/result')
                ? 'match_result_service_unavailable'
                : 'match_notification_service_unavailable';
        return streamingJsonResponse(503, { code });
      },
      random: () => 0,
      sleep: async () => true,
    });
    const cases = [
      ['notifications', () => client.listMatchNotifications(CREDENTIAL)],
      ['chat', () => client.listMatchMessages(CREDENTIAL, MATCH_ID)],
      ['waitlist', () => client.listMatchWaitlist(CREDENTIAL, MATCH_ID)],
      ['lineup', () => client.readMatchLineup(CREDENTIAL, MATCH_ID)],
      ['result', () => client.readMatchResult(CREDENTIAL, MATCH_ID)],
    ];

    for (const [name, invoke] of cases) {
      const baseline = attempts.length;
      const result = await invoke();
      expect(
        {
          result,
          physicalAttempts: attempts.length - baseline,
        },
        name,
      ).toEqual({
        result: {
          outcome: 'rejected',
          reason: 'temporary_unavailable',
        },
        physicalAttempts: 3,
      });
    }
  });
});

const { test: base, expect } = require('@playwright/test');

const SUPABASE_URL = 'https://cnkgwsmcrosxoxcrgdsq.supabase.co';
const SUPABASE_AUTH_KEY = 'sb-cnkgwsmcrosxoxcrgdsq-auth-token';

const testUser = {
  id: 'user-joiner-1',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'qa-player@prostopadel.test',
  user_metadata: {
    first_name: 'QA',
    last_name: 'Player',
    rating: 3.4,
  },
};

const profile = {
  id: testUser.id,
  first_name: 'QA',
  last_name: 'Player',
  rating: 3.4,
  is_verified: true,
  role: 'user',
  phone: '+79990000000',
  side_preference: 'Both',
};

function getTomorrowISO() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function getTomorrowLabel() {
  return new Date(getTomorrowISO())
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    .replace(' Рі.', '');
}

function createOpenJoinableMatch(overrides = {}) {
  return {
    id: 'open-match-join-smoke',
    owner_id: 'user-owner-1',
    ownerId: 'user-owner-1',
    date: getTomorrowLabel(),
    dateISO: getTomorrowISO(),
    time: '19:00',
    duration: 1.5,
    courtId: 'p1',
    courtName: 'РљРѕСЂС‚ 1',
    courtType: 'panoramic',
    isPrime: true,
    type: 'match',
    title: 'РћС‚РєСЂС‹С‚С‹Р№ РјР°С‚С‡ QA',
    description: 'Smoke test match',
    ratingMin: 2,
    ratingMax: 5,
    scenario: 'social',
    status: 'open',
    isPrivate: false,
    paymentStatus: 'full',
    filledSlots: [
      {
        id: 'user-owner-1',
        firstName: 'Owner',
        lastName: 'Player',
        ratingIdx: 3,
        numericRating: 3.4,
        isVerified: true,
        isOrganizer: true,
      },
    ],
    participants: ['user-owner-1'],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function filterPublicProfiles(url, profiles) {
  const params = new URL(url).searchParams;
  let rows = [...profiles];

  for (const idFilter of params.getAll('id')) {
    if (idFilter.startsWith('in.(')) {
      const ids = idFilter.slice(4, -1).split(',').map((id) => id.trim());
      rows = rows.filter((row) => ids.includes(String(row.id)));
    } else if (idFilter.startsWith('neq.')) {
      const excludedId = idFilter.slice(4);
      rows = rows.filter((row) => String(row.id) !== excludedId);
    }
  }

  const rawOrFilter = String(params.get('or') ?? '').toLocaleLowerCase('ru-RU');
  const searchTerms = [...new Set(
    [...rawOrFilter.matchAll(/ilike\.(?:%|\*)?([^%*,)]+)/g)]
      .map((match) => match[1]?.trim())
      .filter(Boolean)
  )];
  if (searchTerms.length > 0) {
    rows = rows.filter((row) =>
      [row.first_name, row.last_name, row.username]
        .filter(Boolean)
        .some((value) => {
          const normalizedValue = String(value).toLocaleLowerCase('ru-RU');
          return searchTerms.some((term) => normalizedValue.includes(term));
        })
    );
  }

  const limit = Number(params.get('limit'));
  return Number.isFinite(limit) && limit > 0 ? rows.slice(0, limit) : rows;
}

function makeJwt(user, expiresAt) {
  const encode = (value) => btoa(JSON.stringify(value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({
      aud: user.aud,
      exp: expiresAt,
      sub: user.id,
      email: user.email,
      role: user.role,
    }),
    'test-signature',
  ].join('.');
}

async function mockSupabase(page, options = {}) {
  const state = {
    matches: options.matches ? structuredClone(options.matches) : [],
    messages: options.messages ? structuredClone(options.messages) : [],
    publicProfiles: options.publicProfiles ? structuredClone(options.publicProfiles) : [structuredClone(profile)],
    invitationRows: options.invitationRows ? structuredClone(options.invitationRows) : [],
    notifications: options.notifications ? structuredClone(options.notifications) : [],
    matchUpdates: [],
    messageCreates: [],
    joinRequests: 0,
    leaveRequests: 0,
    bookingRequests: 0,
    bookingPayloads: [],
    directMatchInserts: 0,
    profileSearchRequests: [],
    createInvitationRequests: 0,
    acceptInvitationRequests: 0,
    declineInvitationRequests: 0,
    cancelInvitationRequests: 0,
    markNotificationReadRequests: 0,
  };
  let matchesGetFailures = options.matchesGetFailures || 0;
  let messagesGetFailures = options.messagesGetFailures || 0;

  await page.route(`${SUPABASE_URL}/auth/v1/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: testUser }),
    });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/profiles**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(profile),
    });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/get_my_profile`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(profile),
    });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/player_public_profiles**`, async (route) => {
    state.profileSearchRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(filterPublicProfiles(route.request().url(), state.publicProfiles)),
    });
  });

  const incomingInvitationPayload = () => state.invitationRows
    .filter((invitation) => invitation.invited_user_id === testUser.id && invitation.status === 'pending')
    .map((invitation) => {
      const match = state.matches.find((row) => row.id === invitation.match_id) || {};
      const organizer = state.publicProfiles.find((row) => row.id === match.owner_id) || {};
      return {
        invitation_id: invitation.id,
        match_id: invitation.match_id,
        invited_by: invitation.invited_by,
        organizer_id: match.owner_id,
        organizer_first_name: organizer.first_name || 'Owner',
        organizer_last_name: organizer.last_name || 'Player',
        date_iso: match.dateISO,
        start_time: match.time,
        court_id: match.courtId,
        court_name: match.courtName,
        court_type: match.courtType,
        match_type: match.type,
        scenario: match.scenario,
        is_private: match.isPrivate,
        rating_min: match.ratingMin,
        rating_max: match.ratingMax,
        price_per_person: match.pricePerPerson,
        slot_index: invitation.slot_index,
        created_at: invitation.created_at,
        match_status: match.status,
      };
    });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/get_incoming_match_invitations`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(incomingInvitationPayload()) });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/match_invitations**`, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const invitedBy = params.get('invited_by')?.replace(/^eq\./, '');
    const status = params.get('status')?.replace(/^eq\./, '');
    const rows = state.invitationRows.filter((invitation) =>
      (!invitedBy || invitation.invited_by === invitedBy) && (!status || invitation.status === status)
    );
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/create_match_invitation`, async (route) => {
    state.createInvitationRequests += 1;
    if (options.createInvitationDelayMs) await new Promise(resolve => setTimeout(resolve, options.createInvitationDelayMs));
    const body = route.request().postDataJSON();
    const invitation = {
      id: `invitation-created-${state.createInvitationRequests}`,
      match_id: body.p_match_id,
      invited_by: testUser.id,
      invited_user_id: body.p_invited_user_id,
      slot_index: body.p_slot_index,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    state.invitationRows.push(invitation);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invitation) });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/accept_match_invitation`, async (route) => {
    state.acceptInvitationRequests += 1;
    const invitationId = route.request().postDataJSON()?.p_invitation_id;
    const invitation = state.invitationRows.find((row) => row.id === invitationId);
    const match = state.matches.find((row) => row.id === invitation?.match_id);
    invitation.status = 'accepted';
    const updated = {
      ...match,
      filledSlots: [...(match.filledSlots || []), {
        id: testUser.id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        numericRating: profile.rating,
        isVerified: profile.is_verified,
        isOrganizer: false,
        slotIndex: invitation.slot_index,
      }],
      participants: [...new Set([...(match.participants || []), testUser.id])],
    };
    state.matches = state.matches.map((row) => row.id === updated.id ? updated : row);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/decline_match_invitation`, async (route) => {
    state.declineInvitationRequests += 1;
    const invitation = state.invitationRows.find((row) => row.id === route.request().postDataJSON()?.p_invitation_id);
    invitation.status = 'declined';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invitation) });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/cancel_match_invitation`, async (route) => {
    state.cancelInvitationRequests += 1;
    const invitation = state.invitationRows.find((row) => row.id === route.request().postDataJSON()?.p_invitation_id);
    invitation.status = 'cancelled';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invitation) });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/get_my_notifications`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.notifications) });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/get_unread_notification_count`, async (route) => {
    const count = state.notifications.filter((notification) => !notification.read_at).length;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(count) });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/mark_notification_read`, async (route) => {
    state.markNotificationReadRequests += 1;
    const notificationId = route.request().postDataJSON()?.p_notification_id;
    const notification = state.notifications.find((row) => row.notification_id === notificationId);
    if (notification) notification.read_at = new Date().toISOString();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(notification || null) });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/join_match`, async (route) => {
    state.joinRequests += 1;
    if (options.joinDelayMs) {
      await new Promise(resolve => setTimeout(resolve, options.joinDelayMs));
    }

    const matchId = route.request().postDataJSON()?.p_match_id;
    const match = state.matches.find(row => String(row.id) === String(matchId));
    const filledSlots = Array.isArray(match?.filledSlots) ? match.filledSlots.filter(Boolean) : [];
    const participants = Array.isArray(match?.participants) ? match.participants : [];

    if (!match || filledSlots.length >= 4 || participants.includes(testUser.id)) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ message: !match ? 'Match not found' : filledSlots.length >= 4 ? 'Match has no free slots' : 'User is already a participant' }),
      });
      return;
    }

    const updated = {
      ...match,
      status: filledSlots.length + 1 >= 4 ? 'upcoming' : 'open',
      filledSlots: [...filledSlots, {
        id: testUser.id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        ratingIdx: 3,
        numericRating: profile.rating,
        isVerified: profile.is_verified,
        isOrganizer: false,
      }],
      participants: [...new Set([...participants, testUser.id])],
    };
    state.matches = state.matches.map(row => row.id === updated.id ? updated : row);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(updated),
    });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/leave_match`, async (route) => {
    state.leaveRequests += 1;
    const matchId = route.request().postDataJSON()?.p_match_id;
    const match = state.matches.find(row => String(row.id) === String(matchId));

    if (!match) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Match not found' }) });
      return;
    }

    const updated = {
      ...match,
      status: 'open',
      filledSlots: (match.filledSlots || []).filter(slot => slot?.id !== testUser.id),
      participants: (match.participants || []).filter(id => id !== testUser.id),
    };
    state.matches = state.matches.map(row => row.id === updated.id ? updated : row);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(updated),
    });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/remove_match_participant`, async (route) => {
    const body = route.request().postDataJSON();
    const match = state.matches.find(row => row.id === body.p_match_id);
    const updated = {
      ...match,
      status: 'open',
      filledSlots: (match.filledSlots || []).filter(slot => slot?.id !== body.p_user_id),
      participants: (match.participants || []).filter(id => id !== body.p_user_id),
    };
    state.matches = state.matches.map(row => row.id === updated.id ? updated : row);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/create_booking`, async (route) => {
    state.bookingRequests += 1;
    const booking = route.request().postDataJSON()?.p_booking;
    state.bookingPayloads.push(booking);

    if (options.createBookingDelayMs) {
      await new Promise(resolve => setTimeout(resolve, options.createBookingDelayMs));
    }

    if (options.createBookingSlotTaken) {
      state.matches.unshift({
        id: 'concurrent-booking',
        owner_id: 'other-booking-owner',
        created_at: new Date().toISOString(),
        ...booking,
        status: 'upcoming',
        isPrivate: true,
        filledSlots: [],
        participants: ['other-booking-owner'],
      });
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          code: '23P01',
          message: 'BOOKING_SLOT_TAKEN',
          details: 'The requested court interval overlaps an active match or booking.',
          hint: null,
        }),
      });
      return;
    }

    const created = {
      id: `created-booking-${state.bookingRequests}`,
      owner_id: testUser.id,
      created_at: new Date().toISOString(),
      ...booking,
      status: booking.isPrivate ? 'upcoming' : 'open',
      filledSlots: [{
        id: testUser.id,
        firstName: profile.first_name,
        lastName: profile.last_name,
        numericRating: profile.rating,
        isVerified: profile.is_verified,
        isOrganizer: true,
      }],
      participants: [testUser.id],
    };
    state.matches.unshift(created);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(created),
    });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/matches**`, async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());

    if (method === 'PATCH') {
      const body = request.postDataJSON();
      const idParam = url.searchParams.get('id');
      const targetId = idParam?.startsWith('eq.') ? idParam.slice(3) : null;
      const index = state.matches.findIndex(match => String(match.id) === String(targetId));
      const updated = index >= 0
        ? { ...state.matches[index], ...body }
        : { id: targetId || `match-${state.matches.length + 1}`, ...body };

      if (index >= 0) {
        state.matches[index] = updated;
      } else {
        state.matches.unshift(updated);
      }

      state.matchUpdates.push({ id: updated.id, body, match: updated });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([updated]),
      });
      return;
    }

    if (method === 'POST') {
      state.directMatchInserts += 1;
      const body = request.postDataJSON();
      const inserted = Array.isArray(body) ? body : [body];
      const rows = inserted.map((match, index) => ({
        id: match.id || `created-match-${state.matches.length + index + 1}`,
        created_at: new Date().toISOString(),
        ...match,
      }));
      state.matches.unshift(...rows);

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(rows),
      });
      return;
    }

    if (options.matchesDelayMs) {
      await new Promise(resolve => setTimeout(resolve, options.matchesDelayMs));
    }

    if (matchesGetFailures > 0) {
      matchesGetFailures -= 1;
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST100', message: 'Mocked matches load failure' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.matches),
    });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/messages**`, async (route) => {
    const request = route.request();
    const method = request.method();

    if (method === 'POST') {
      const body = request.postDataJSON();
      const inserted = Array.isArray(body) ? body : [body];
      const rows = inserted.map((message, index) => ({
        id: message.id || `message-${state.messages.length + index + 1}`,
        timestamp: new Date().toISOString(),
        created_at: new Date().toISOString(),
        ...message,
      }));
      state.messages.push(...rows);
      state.messageCreates.push(...rows.map((row, index) => ({
        body: inserted[index],
        row,
      })));

      const responseRows = options.duplicateMessageInsertResponse
        ? rows.flatMap(row => [row, row])
        : rows;

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(responseRows),
      });
      return;
    }

    if (options.messagesDelayMs) {
      await new Promise(resolve => setTimeout(resolve, options.messagesDelayMs));
    }

    if (messagesGetFailures > 0) {
      messagesGetFailures -= 1;
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'PGRST100', message: 'Mocked messages load failure' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.messages),
    });
  });

  return state;
}

async function mockTelegram(page) {
  await page.addInitScript(() => {
    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        super();
        this.url = url;
        this.readyState = MockWebSocket.OPEN;
        setTimeout(() => {
          this.onopen?.({ target: this });
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({ target: this });
        this.dispatchEvent(new Event('close'));
      }
    }

    window.WebSocket = MockWebSocket;
    window.Telegram = {
      WebApp: {
        initData: 'query_id=test',
        initDataUnsafe: {
          query_id: 'test-query',
          user: {
            id: 123456789,
            first_name: 'QA',
            last_name: 'Player',
            username: 'qa_player',
            photo_url: '',
          },
        },
        BackButton: {
          show() {},
          hide() {},
          onClick() {},
          offClick() {},
        },
        HapticFeedback: {
          impactOccurred() {},
          selectionChanged() {},
          notificationOccurred() {},
        },
        ready() {},
        expand() {},
        close() {},
        sendData() {},
        showConfirm(_message, callback) {
          callback(false);
        },
      },
    };
  });
}

async function setAuthenticatedSession(page) {
  await page.addInitScript(({ storageKey, user }) => {
    const encode = (value) => btoa(JSON.stringify(value))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const accessToken = [
      encode({ alg: 'HS256', typ: 'JWT' }),
      encode({
        aud: user.aud,
        exp: expiresAt,
        sub: user.id,
        email: user.email,
        role: user.role,
      }),
      'test-signature',
    ].join('.');

    localStorage.setItem(storageKey, JSON.stringify({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      refresh_token: 'test-refresh-token',
      user,
    }));
  }, {
    storageKey: SUPABASE_AUTH_KEY,
    user: testUser,
  });
}

async function openAuthenticatedApp(page) {
  await mockSupabase(page);
  await mockTelegram(page);
  await setAuthenticatedSession(page);
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();
}

async function openMatchesTab(page) {
  await page.locator('.bottom-nav').getByRole('button', { name: 'Матчи' }).click();
  await expect(page.locator('.bottom-nav').getByRole('button', { name: 'Матчи' })).toHaveAttribute('aria-current', 'page');
}

async function openBookingTab(page) {
  const bookingTab = page.locator('.bottom-nav').getByRole('button', { name: 'Бронь' });
  await bookingTab.click();
  await expect(bookingTab).toHaveAttribute('aria-current', 'page');
}

async function openProfileTab(page) {
  const profileTab = page.locator('.bottom-nav').getByRole('button', { name: 'Профиль' });
  await profileTab.click();
  await expect(profileTab).toHaveAttribute('aria-current', 'page');
}

async function selectTomorrowCourtOneAtSeven(page) {
  await openBookingTab(page);
  await page.locator('.booking-date-card').nth(1).click();
  await page.getByRole('button', { name: 'Корт 1', exact: true }).click();
  const slot = page.locator('.booking-time-slot').filter({
    has: page.getByText('07:00', { exact: true }),
  });
  await expect(slot).toBeEnabled();
  await slot.click();
  await expect(page.getByRole('dialog', { name: 'Подтверждение брони' })).toBeVisible();
  return slot;
}

const test = base.extend({
  page: async ({ page }, use) => {
    const consoleErrors = [];
    const failedNetwork = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    page.on('requestfailed', (request) => {
      failedNetwork.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.trim());
    });

    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();
      if (status >= 400 && !url.endsWith('/favicon.ico')) {
        failedNetwork.push(`${status} ${url}`);
      }
    });

    await use(page);

    expect.soft(consoleErrors, 'console errors').toEqual([]);
    expect.soft(failedNetwork, 'failed network requests').toEqual([]);
  },
});

test('opens authorized home on iPhone viewport', async ({ page }) => {
  await openAuthenticatedApp(page);

  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('.bottom-nav')).toBeVisible();

  const viewport = page.viewportSize();
  expect(viewport?.width).toBe(390);
  expect(viewport?.height).toBeGreaterThanOrEqual(600);
});

test('checks bottom navigation and match creation smoke', async ({ page }) => {
  await openAuthenticatedApp(page);

  const nav = page.locator('.bottom-nav');
  const navButtons = nav.getByRole('button');

  await navButtons.nth(4).click();
  await expect(navButtons.nth(4)).toHaveAttribute('aria-current', 'page');

  await navButtons.nth(3).click();
  await expect(navButtons.nth(3)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Рейтинг клуба' })).toBeVisible();

  await navButtons.nth(2).click();
  await expect(navButtons.nth(2)).toHaveAttribute('aria-current', 'page');

  await navButtons.nth(1).click();
  await expect(navButtons.nth(1)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('QA Player')).toBeVisible();
});

test('BOOKING creates a public booking through create_booking', async ({ page }) => {
  const supabaseState = await mockSupabase(page);
  await mockTelegram(page);
  await setAuthenticatedSession(page);
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();

  await selectTomorrowCourtOneAtSeven(page);
  await page.getByRole('button', { name: 'Бронь + сбор игроков' }).click();
  await page.getByRole('button', { name: 'Создать матч' }).click();

  await expect.poll(() => supabaseState.bookingRequests).toBe(1);
  await expect(page.locator('.bottom-nav').getByRole('button', { name: 'Матчи' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Открытый матч', { exact: true })).toBeVisible();

  expect(supabaseState.directMatchInserts).toBe(0);
  expect(supabaseState.bookingPayloads[0]).toMatchObject({
    time: '07:00',
    duration: 1.5,
    courtId: 'p1',
    courtName: 'Корт 1',
    courtType: 'panoramic',
    type: 'match',
    scenario: 'social',
    isPrivate: false,
    paymentStatus: 'partial',
  });
  expect(supabaseState.bookingPayloads[0]).not.toHaveProperty('owner_id');
  expect(supabaseState.matches[0]).toMatchObject({
    owner_id: testUser.id,
    participants: [testUser.id],
    status: 'open',
  });
});

base('BOOKING refreshes availability when create_booking returns BOOKING_SLOT_TAKEN', async ({ page }) => {
  const supabaseState = await mockSupabase(page, { createBookingSlotTaken: true });
  await mockTelegram(page);
  await setAuthenticatedSession(page);
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();

  const slot = await selectTomorrowCourtOneAtSeven(page);
  await page.getByRole('button', { name: 'Создать бронь' }).click();

  await expect(page.getByText('Это время уже заняли. Выберите другой интервал', { exact: true })).toBeVisible();
  await expect.poll(() => supabaseState.bookingRequests).toBe(1);
  await expect(slot).toBeDisabled();
  await expect(slot).toContainText('Занято');
  expect(supabaseState.directMatchInserts).toBe(0);
});

test('BOOKING ignores a rapid repeated confirmation click', async ({ page }) => {
  const supabaseState = await mockSupabase(page, { createBookingDelayMs: 300 });
  await mockTelegram(page);
  await setAuthenticatedSession(page);
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();

  await selectTomorrowCourtOneAtSeven(page);
  const confirmButton = page.getByRole('button', { name: 'Создать бронь' });
  await confirmButton.evaluate(button => {
    button.click();
    button.click();
  });

  await expect(page.getByRole('button', { name: 'Сохраняем...' })).toBeDisabled();
  await expect.poll(() => supabaseState.bookingRequests).toBe(1);
  await expect(page.getByRole('main').getByText('Бронь создана. Оплата сейчас подтверждается через администратора клуба.', { exact: true })).toBeVisible();
  await expect(page.locator('.bottom-nav').getByRole('button', { name: 'Бронь' })).toHaveAttribute('aria-current', 'page');
  expect(supabaseState.bookingRequests).toBe(1);
  expect(supabaseState.bookingPayloads[0]).toMatchObject({
    type: 'private',
    scenario: 'private',
    isPrivate: true,
    paymentStatus: 'full',
  });
  expect(supabaseState.directMatchInserts).toBe(0);
});

base('OPEN-MATCH shows loading, retryable load error and empty state', async ({ page }) => {
  await mockSupabase(page, { matchesGetFailures: 1, matchesDelayMs: 250 });
  await mockTelegram(page);
  await setAuthenticatedSession(page);

  await page.goto('/');
  await expect(page.getByTestId('app-loader')).toBeVisible();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await openMatchesTab(page);

  await expect(page.getByTestId('matches-load-error')).toBeVisible();
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByTestId('matches-loading')).toBeVisible();
  await expect(page.getByText('Пока нет открытых матчей')).toBeVisible();
});

test('OPEN-MATCH renders facts, full state and mobile layout', async ({ page }) => {
  const fullMatch = createOpenJoinableMatch({
    id: 'full-open-match',
    title: 'Заполненный матч QA',
    date: '17 июля',
    time: '19:00',
    duration: 1.5,
    ratingMin: 2,
    ratingMax: 4,
    pricePerPerson: 777,
    status: 'upcoming',
    filledSlots: [
      createOpenJoinableMatch().filledSlots[0],
      { id: 'player-2', firstName: 'Ирина', numericRating: 3.1 },
      { id: 'player-3', firstName: 'Максим', numericRating: 3.6 },
      { id: 'player-4', firstName: 'Ольга', numericRating: 2.9 },
    ],
    participants: ['user-owner-1', 'player-2', 'player-3', 'player-4'],
  });
  await mockSupabase(page, { matches: [fullMatch] });
  await mockTelegram(page);
  await setAuthenticatedSession(page);
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await openMatchesTab(page);

  await expect(page.getByText('17 июля', { exact: true })).toBeVisible();
  await expect(page.getByText('19:00 — 20:30', { exact: true })).toBeVisible();
  await expect(page.getByText('C — B', { exact: true })).toBeVisible();
  await expect(page.getByText('777 ₽', { exact: true })).toBeVisible();
  await expect(page.getByTestId('match-free-spots-full-open-match')).toHaveText('Свободно: 0');
  await expect(page.getByText('Матч заполнен', { exact: true })).toBeVisible();

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(0);

  await page.getByText('Заполненный матч QA', { exact: true }).click();
  await expect(page.getByText('Дата: 17 июля', { exact: true })).toBeVisible();
  await expect(page.getByText('Время: 19:00', { exact: true })).toBeVisible();
  await expect(page.getByText('777 ₽', { exact: true })).toBeVisible();
  await expect(page.getByTestId('match-self-join-button')).toBeDisabled();
  await expect(page.getByTestId('match-self-join-button')).toHaveText('Матч заполнен');
});

test('OPEN-MATCH organizer manages but cannot self-join or leave', async ({ page }) => {
  const ownerMatch = createOpenJoinableMatch({
    id: 'owner-open-match',
    owner_id: testUser.id,
    ownerId: testUser.id,
    title: 'Матч организатора QA',
    filledSlots: [{
      id: testUser.id,
      firstName: 'QA',
      lastName: 'Player',
      ratingIdx: 3,
      numericRating: 3.4,
      isVerified: true,
      isOrganizer: true,
    }],
    participants: [testUser.id],
  });
  await mockSupabase(page, { matches: [ownerMatch] });
  await mockTelegram(page);
  await setAuthenticatedSession(page);
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await openMatchesTab(page);

  await expect(page.getByText('Ваш матч', { exact: true })).toBeVisible();
  await page.getByText('Матч организатора QA', { exact: true }).click();
  await expect(page.getByText('Организатор', { exact: true })).toBeVisible();
  await expect(page.getByText('Вы управляете этой игрой', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть чат игры' })).toBeVisible();
  await expect(page.getByTestId('match-self-join-button')).toHaveCount(0);

  await page.getByTestId('match-filled-slot-0').click();
  await expect(page.getByTestId('player-slot-remove-action')).toHaveCount(0);
});

test('PLAYER-SEARCH finds names case-insensitively, partially and without duplicates', async ({ page }) => {
  const profileRow = (id, firstName, lastName, username) => ({
    id,
    first_name: firstName,
    last_name: lastName,
    username,
    rating: 3.0,
    is_verified: true,
    side_preference: 'Both',
  });
  const exact = profileRow('search-exact', 'Алекс', 'Точный', 'alex_exact');
  const prefix = profileRow('search-prefix', 'Александр', 'Иванов', 'alexander_ivanov');
  const contains = profileRow('search-contains', 'Сан-Алексей', 'Петров', 'contains_alex');
  const irrelevant = profileRow('search-irrelevant', 'Мария', 'Смирнова', 'maria_smirnova');
  const ownerMatch = createOpenJoinableMatch({
    id: 'player-search-match',
    owner_id: testUser.id,
    ownerId: testUser.id,
    title: 'Поиск игроков QA',
    filledSlots: [{
      id: testUser.id,
      firstName: profile.first_name,
      lastName: profile.last_name,
      numericRating: profile.rating,
      isVerified: profile.is_verified,
      isOrganizer: true,
    }],
    participants: [testUser.id],
  });
  const supabaseState = await mockSupabase(page, {
    matches: [ownerMatch],
    publicProfiles: [contains, prefix, exact, { ...prefix }, irrelevant],
  });
  await mockTelegram(page);
  await setAuthenticatedSession(page);
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();

  await openMatchesTab(page);
  await page.getByText(ownerMatch.title, { exact: true }).click();
  await page.getByTestId('match-empty-slot-1').click();

  const input = page.getByTestId('player-search-input');
  const prefixResult = page.getByTestId(`player-search-result-${prefix.id}`);
  const allResults = page.locator('[data-testid^="player-search-result-"]');
  let requestCount = supabaseState.profileSearchRequests.length;

  await input.fill('александр');
  await expect.poll(() => supabaseState.profileSearchRequests.length).toBe(++requestCount);
  await expect(prefixResult).toBeVisible();

  await input.fill('Александр');
  await expect.poll(() => supabaseState.profileSearchRequests.length).toBe(++requestCount);
  await expect(prefixResult).toBeVisible();

  await input.fill('алекс');
  await expect.poll(() => supabaseState.profileSearchRequests.length).toBe(++requestCount);
  await expect(allResults).toHaveCount(3);
  await expect(allResults.nth(0)).toHaveAttribute('data-testid', `player-search-result-${exact.id}`);
  await expect(allResults.nth(1)).toHaveAttribute('data-testid', `player-search-result-${prefix.id}`);
  await expect(allResults.nth(2)).toHaveAttribute('data-testid', `player-search-result-${contains.id}`);

  await input.fill('  александр  ');
  await expect.poll(() => supabaseState.profileSearchRequests.length).toBe(++requestCount);
  await expect(prefixResult).toBeVisible();

  await input.fill('марсианин');
  await expect.poll(() => supabaseState.profileSearchRequests.length).toBe(++requestCount);
  await expect(allResults).toHaveCount(0);
  await expect(prefixResult).toHaveCount(0);
});

base('OPEN-MATCH chat shows a retryable load error', async ({ page }) => {
  const participantSlot = {
    id: testUser.id,
    firstName: 'QA',
    lastName: 'Player',
    ratingIdx: 3,
    numericRating: 3.4,
    isVerified: true,
    isOrganizer: false,
  };
  const match = createOpenJoinableMatch({
    id: 'chat-load-error-match',
    title: 'Чат с повторной загрузкой',
    filledSlots: [createOpenJoinableMatch().filledSlots[0], participantSlot],
    participants: ['user-owner-1', testUser.id],
  });
  await mockSupabase(page, {
    matches: [match],
    messagesGetFailures: 1,
    messagesDelayMs: 200,
  });
  await mockTelegram(page);
  await setAuthenticatedSession(page);
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await openMatchesTab(page);
  await page.getByText('Чат с повторной загрузкой', { exact: true }).click();
  await page.getByRole('button', { name: 'Открыть чат игры' }).click();

  await expect(page.getByTestId('chat-load-error')).toBeVisible();
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByTestId('chat-loading')).toBeVisible();
  await expect(page.getByText('Сообщений пока нет. Начните общение!')).toBeVisible();
});

test('OPEN-MATCH joins once, leaves, reloads and can join again', async ({ page }) => {
  const supabaseState = await mockSupabase(page, {
    matches: [createOpenJoinableMatch({ title: 'Join smoke match' })],
    joinDelayMs: 200,
  });
  await mockTelegram(page);
  await setAuthenticatedSession(page);
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();

  await openMatchesTab(page);
  await page.getByText('Join smoke match').click();
  const joinButton = page.getByTestId('match-self-join-button');
  await joinButton.evaluate(button => {
    button.click();
    button.click();
  });

  await expect(page.getByTestId('match-joined-state')).toBeVisible();
  await expect.poll(() => supabaseState.joinRequests).toBe(1);
  expect(supabaseState.matches[0].filledSlots).toHaveLength(2);
  expect(supabaseState.matches[0].filledSlots[1]).toMatchObject({
    id: testUser.id,
    firstName: 'QA',
    lastName: 'Player',
    isOrganizer: false,
  });
  expect(supabaseState.matches[0].participants).toContain(testUser.id);

  await page.getByTestId('match-filled-slot-1').click();
  await page.getByTestId('player-slot-remove-action').click();
  await page.getByTestId('match-leave-confirm-button').click();
  await expect(page.getByTestId('match-self-join-button')).toBeVisible();
  await expect.poll(() => supabaseState.leaveRequests).toBe(1);
  await page.waitForTimeout(1700);
  await expect(page.getByRole('heading', { name: 'Детали матча' })).toBeVisible();
  expect(supabaseState.matches[0].participants).not.toContain(testUser.id);

  await page.reload();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await openMatchesTab(page);
  await page.getByText('Join smoke match').click();
  await expect(page.getByTestId('match-self-join-button')).toBeVisible();

  await page.getByTestId('match-self-join-button').click();
  await expect(page.getByTestId('match-joined-state')).toBeVisible();
  await expect.poll(() => supabaseState.joinRequests).toBe(2);
  expect(supabaseState.matches[0].participants.filter(id => id === testUser.id)).toHaveLength(1);
  expect(supabaseState.matches[0].filledSlots.filter(slot => slot?.id === testUser.id)).toHaveLength(1);
});

test('does not crash in a browser without Telegram.WebApp', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');

  await expect(page.getByRole('heading').first()).toBeVisible();
  await page.locator('button').first().click();
  await expect(page.getByRole('heading').first()).toBeVisible();
});
test('OPEN-MATCH chat sends once, stays scoped and persists after reload', async ({ page }) => {
  const participantSlot = {
    id: testUser.id,
    firstName: 'QA',
    lastName: 'Player',
    ratingIdx: 3,
    numericRating: 3.4,
    isVerified: true,
    isOrganizer: false,
  };
  const ownerSlot = createOpenJoinableMatch().filledSlots[0];
  const chatMatch = createOpenJoinableMatch({
    id: 'chat-match-smoke',
    title: 'Chat smoke match',
    filledSlots: [ownerSlot, participantSlot],
    participants: ['user-owner-1', testUser.id],
  });
  const otherMatch = createOpenJoinableMatch({
    id: 'other-chat-match-smoke',
    owner_id: 'user-owner-2',
    ownerId: 'user-owner-2',
    title: 'Other chat match',
    filledSlots: [
      {
        id: 'user-owner-2',
        firstName: 'Other',
        lastName: 'Owner',
        ratingIdx: 3,
        numericRating: 3.4,
        isVerified: true,
        isOrganizer: true,
      },
      participantSlot,
    ],
    participants: ['user-owner-2', testUser.id],
  });
  const messageText = 'Р‘СѓРґСѓ Р·Р° 10 РјРёРЅСѓС‚';
  const otherMessageText = 'Other match only message';
  const supabaseState = await mockSupabase(page, {
    matches: [chatMatch, otherMatch],
    messages: [{
      id: 'other-message-1',
      match_id: otherMatch.id,
      sender_id: 'user-owner-2',
      sender_name: 'Other',
      text: otherMessageText,
      timestamp: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }],
    duplicateMessageInsertResponse: true,
  });

  await mockTelegram(page);
  await setAuthenticatedSession(page);
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();

  const chatButton = page.getByRole('button', { name: 'Открыть чат игры' });

  await openMatchesTab(page);
  await page.getByText('Chat smoke match').click();
  await chatButton.click();
  await expect(page.getByText(otherMessageText, { exact: true })).toHaveCount(0);

  await page.locator('textarea').last().fill(messageText);
  await page.locator('textarea').last().press('Enter');

  await expect(page.getByText(messageText, { exact: true })).toHaveCount(1);
  await expect.poll(() => supabaseState.messageCreates.length).toBe(1);
  expect(supabaseState.messageCreates[0].body).toMatchObject({
    match_id: chatMatch.id,
    sender_id: testUser.id,
    sender_name: 'QA',
    text: messageText,
  });
  expect(supabaseState.messages.filter(message => message.text === messageText)).toHaveLength(1);

  await page.getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('button', { name: '←' }).click();
  await page.getByText('Other chat match').click();
  await chatButton.click();
  await expect(page.getByText(otherMessageText, { exact: true })).toBeVisible();
  await expect(page.getByText(messageText, { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await openMatchesTab(page);
  await page.getByText('Chat smoke match').click();
  await chatButton.click();
  await expect(page.getByText(messageText, { exact: true })).toHaveCount(1);
});

test.describe('INVITATION frontend flow', () => {
  const invitedPlayer = {
    id: 'invited-player-1', first_name: 'Анна', last_name: 'Соколова', username: 'anna_sokolova',
    rating: 3.1, is_verified: true, side_preference: 'Both',
  };
  const ownerProfile = {
    id: 'user-owner-1', first_name: 'Олег', last_name: 'Организатор', username: 'owner_oleg',
    rating: 3.4, is_verified: true,
  };

  const ownerMatch = (overrides = {}) => createOpenJoinableMatch({
    id: 'invitation-owner-match', owner_id: testUser.id, ownerId: testUser.id,
    title: 'Матч с приглашением', courtName: 'Панорама 1', pricePerPerson: 1250,
    filledSlots: [{
      id: testUser.id, firstName: 'QA', lastName: 'Player', ratingIdx: 3,
      numericRating: 3.4, isVerified: true, isOrganizer: true, slotIndex: 0,
    }],
    participants: [testUser.id],
    ...overrides,
  });

  const incomingFixture = () => {
    const match = createOpenJoinableMatch({
      id: 'invitation-incoming-match', title: 'Входящий матч', courtName: 'Корт Центр',
      ratingMin: 2, ratingMax: 4, pricePerPerson: 990,
    });
    const invitation = {
      id: 'incoming-invitation-1', match_id: match.id, invited_by: match.owner_id,
      invited_user_id: testUser.id, slot_index: 1, status: 'pending', created_at: new Date().toISOString(),
    };
    const notification = {
      notification_id: 'notification-invitation-1', notification_type: 'match_invitation',
      match_id: match.id, invitation_id: invitation.id, title: 'Новое приглашение',
      body: 'Олег приглашает вас в матч', data: {}, created_at: new Date().toISOString(), read_at: null,
    };
    return { match, invitation, notification };
  };

  test('INVITATION organizer sends one RPC request and pending player is not confirmed', async ({ page }) => {
    const match = ownerMatch();
    const state = await mockSupabase(page, {
      matches: [match], publicProfiles: [profile, invitedPlayer], createInvitationDelayMs: 150,
    });
    await mockTelegram(page);
    await setAuthenticatedSession(page);
    await page.goto('/');
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await openMatchesTab(page);
    await page.getByText(match.title, { exact: true }).click();
    await page.getByTestId('match-empty-slot-1').click();
    await page.getByTestId('player-search-input').fill('Анна');
    const result = page.getByTestId(`player-search-result-${invitedPlayer.id}`);
    await expect(result).toBeVisible();
    await result.evaluate((button) => { button.click(); button.click(); });

    await expect.poll(() => state.createInvitationRequests).toBe(1);
    await expect(page.getByText('Ожидает ответа', { exact: true }).first()).toBeVisible();
    expect(state.matches[0].participants).toEqual([testUser.id]);
    expect(state.matches[0].filledSlots).toHaveLength(1);
    expect(state.invitationRows).toHaveLength(1);
  });

  test('PROFILE-NOTIFICATIONS are absent on Home and visible as a horizontal rail in Profile', async ({ page }) => {
    const { match, invitation, notification } = incomingFixture();
    const notifications = Array.from({ length: 12 }, (_, index) => ({
      ...notification, notification_id: `notification-${index + 1}`,
      invitation_id: index === 0 ? invitation.id : `other-${index}`,
      notification_type: index === 0 ? 'match_invitation' : 'waitlist_promoted',
    }));
    await mockSupabase(page, {
      matches: [match], invitationRows: [invitation], notifications,
      publicProfiles: [profile, ownerProfile],
    });
    await mockTelegram(page);
    await setAuthenticatedSession(page);
    await page.goto('/');

    await expect(page.getByTestId('profile-notifications')).toHaveCount(0);
    await expect(page.getByTestId(`invitation-card-${invitation.id}`)).toHaveCount(0);
    await expect(page.getByTestId('profile-notification-badge')).toHaveText('9+');
    await openProfileTab(page);

    const card = page.getByTestId(`invitation-card-${invitation.id}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText('Олег Организатор');
    await expect(card).toContainText(match.time);
    await expect(card).toContainText(match.courtName);
    await expect(card).toContainText('C–B');
    await expect(card).toContainText('990 ₽');
    const rail = page.getByTestId('profile-notifications-rail');
    await expect(rail).toBeVisible();
    expect(await rail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    const firstBox = await rail.locator('.profile-notification-card').nth(0).boundingBox();
    const secondBox = await rail.locator('.profile-notification-card').nth(1).boundingBox();
    expect(firstBox.width).toBeGreaterThan((await rail.boundingBox()).width * 0.8);
    expect(secondBox.x).toBeGreaterThan(firstBox.x);
  });

  test('INVITATION acceptance adds invitee, marks notification read and opens match', async ({ page }) => {
    const { match, invitation, notification } = incomingFixture();
    const state = await mockSupabase(page, {
      matches: [match], invitationRows: [invitation], notifications: [notification],
      publicProfiles: [profile, ownerProfile],
    });
    await mockTelegram(page);
    await setAuthenticatedSession(page);
    await page.goto('/');

    await openProfileTab(page);
    await page.getByTestId(`invitation-accept-${invitation.id}`).click();
    await expect(page.getByTestId(`invitation-card-${invitation.id}`)).toHaveCount(0);
    await expect.poll(() => state.acceptInvitationRequests).toBe(1);
    await expect.poll(() => state.markNotificationReadRequests).toBe(1);
    await expect(page.getByRole('button', { name: '←' })).toBeVisible();
    await expect(page.getByText(match.title, { exact: true }).first()).toBeVisible();
    expect(state.matches[0].participants).toContain(testUser.id);
    expect(state.matches[0].filledSlots.some((slot) => slot?.id === testUser.id)).toBe(true);

    await page.reload();
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await openProfileTab(page);
    await expect(page.getByTestId(`invitation-card-${invitation.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`notification-card-${notification.notification_id}`)).toHaveCount(0);
    await expect(page.getByText(match.title, { exact: true }).first()).toBeVisible();
  });

  test('INVITATION decline removes card immediately and releases reservation', async ({ page }) => {
    const { match, invitation, notification } = incomingFixture();
    const state = await mockSupabase(page, {
      matches: [match], invitationRows: [invitation], notifications: [notification],
      publicProfiles: [profile, ownerProfile],
    });
    await mockTelegram(page);
    await setAuthenticatedSession(page);
    await page.goto('/');

    await openProfileTab(page);
    await page.getByTestId(`invitation-decline-${invitation.id}`).click();
    await expect(page.getByTestId(`invitation-card-${invitation.id}`)).toHaveCount(0);
    await expect(page.getByTestId('profile-notification-badge')).toHaveCount(0);
    expect(state.declineInvitationRequests).toBe(1);
    expect(state.invitationRows[0].status).toBe('declined');
    expect(state.matches[0].participants).not.toContain(testUser.id);
    expect(state.matches[0].filledSlots).toHaveLength(1);
    await expect(page.getByText('Вы отказались от приглашения. Слот освобождён.')).toBeVisible();

    await page.reload();
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await openProfileTab(page);
    await expect(page.getByTestId(`invitation-card-${invitation.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`notification-card-${notification.notification_id}`)).toHaveCount(0);
  });

  test('INVITATION cancelled on another device is not rendered from notification history', async ({ page }) => {
    const { match, invitation, notification } = incomingFixture();
    invitation.status = 'cancelled';
    const waitlistNotification = {
      notification_id: 'waitlist-still-visible',
      notification_type: 'waitlist_promoted',
      match_id: match.id,
      invitation_id: null,
      title: 'Вы попали в игру',
      body: 'Освободилось место.',
      data: {},
      created_at: new Date().toISOString(),
      read_at: null,
    };
    await mockSupabase(page, {
      matches: [match],
      invitationRows: [invitation],
      notifications: [notification, waitlistNotification],
      publicProfiles: [profile, ownerProfile],
    });
    await mockTelegram(page);
    await setAuthenticatedSession(page);
    await page.goto('/');
    await openProfileTab(page);

    await expect(page.getByTestId(`invitation-card-${invitation.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`notification-card-${notification.notification_id}`)).toHaveCount(0);
    await expect(page.getByTestId(`notification-card-${waitlistNotification.notification_id}`)).toBeVisible();
  });

  test('INVITATION organizer cancels pending invitation and slot becomes free', async ({ page }) => {
    const match = ownerMatch();
    const invitation = {
      id: 'outgoing-invitation-1', match_id: match.id, invited_by: testUser.id,
      invited_user_id: invitedPlayer.id, slot_index: 1, status: 'pending', created_at: new Date().toISOString(),
    };
    const state = await mockSupabase(page, {
      matches: [match], invitationRows: [invitation], publicProfiles: [profile, invitedPlayer],
    });
    await mockTelegram(page);
    await setAuthenticatedSession(page);
    await page.goto('/');
    await openMatchesTab(page);
    await page.getByText(match.title, { exact: true }).click();

    await expect(page.getByTestId(`pending-invitation-${invitation.id}`)).toBeVisible();
    await page.getByTestId(`cancel-invitation-${invitation.id}`).click();
    await expect(page.getByTestId(`pending-invitation-${invitation.id}`)).toHaveCount(0);
    await expect(page.getByTestId('match-empty-slot-1')).toBeVisible();
    expect(state.cancelInvitationRequests).toBe(1);
    expect(state.invitationRows[0].status).toBe('cancelled');
  });
});

test('PROFILE-RESULTS use a horizontal rail, real outcomes and real statistics', async ({ page }) => {
  const teammate = { id: 'result-player-2', firstName: 'Очень Длинное Имя', lastName: 'Партнёра', numericRating: 3.2, isVerified: true };
  const opponentOne = { id: 'result-player-3', firstName: 'Мария', lastName: 'Смирнова', numericRating: 3.5, isVerified: true };
  const opponentTwo = { id: 'result-player-4', firstName: 'Илья', lastName: 'Петров', numericRating: 3.0, isVerified: true };
  const me = { id: testUser.id, firstName: 'QA', lastName: 'Player', numericRating: 3.4, isVerified: true };
  const completedMatch = ({ id, title, isTeam1Win, completedAt, delta, score }) => createOpenJoinableMatch({
    id,
    title,
    status: 'completed',
    completedAt,
    participants: [testUser.id, teammate.id, opponentOne.id, opponentTwo.id],
    filledSlots: [me, teammate, opponentOne, opponentTwo],
    team1: [me, teammate],
    team2: [opponentOne, opponentTwo],
    isTeam1Win,
    finalScore: score,
    ratingChanges: {
      [testUser.id]: { before: 3.4, after: 3.4 + delta, delta },
      [teammate.id]: { before: 3.2, after: 3.2 + delta, delta },
      [opponentOne.id]: { before: 3.5, after: 3.5 - delta, delta: -delta },
      [opponentTwo.id]: { before: 3.0, after: 3.0 - delta, delta: -delta },
    },
  });
  const win = completedMatch({
    id: 'profile-result-win', title: 'Победный матч', isTeam1Win: true,
    completedAt: '2026-07-16T18:30:00.000Z', delta: 0.08,
    score: [{ t1: 6, t2: 3 }, { t1: 6, t2: 4 }],
  });
  const loss = completedMatch({
    id: 'profile-result-loss', title: 'Проигранный матч', isTeam1Win: false,
    completedAt: '2026-07-15T18:30:00.000Z', delta: -0.05,
    score: [{ t1: 4, t2: 6 }, { t1: 3, t2: 6 }],
  });

  await mockSupabase(page, { matches: [win, loss] });
  await mockTelegram(page);
  await setAuthenticatedSession(page);
  await page.goto('/');
  await openProfileTab(page);

  const rail = page.getByTestId('profile-results-rail');
  await expect(rail).toBeVisible();
  await expect(page.getByTestId('result-card-win')).toBeVisible();
  await expect(page.getByTestId('result-card-loss')).toBeVisible();
  const winBox = await page.getByTestId('result-card-win').boundingBox();
  const lossBox = await page.getByTestId('result-card-loss').boundingBox();
  expect(Math.abs(winBox.y - lossBox.y)).toBeLessThan(2);
  expect(lossBox.x).toBeGreaterThan(winBox.x);
  expect(await rail.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await rail.evaluate((element) => element.scrollTo({ left: element.scrollWidth, behavior: 'auto' }));
  await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  const stats = page.getByTestId('profile-match-stats');
  await expect(stats).toContainText('50%');
  await expect(stats).toContainText('2');
  await expect(stats).toContainText('Выиграно');
  await expect(stats).toContainText('Проиграно');
  await expect(page.getByTestId('result-card-win')).toContainText('+0.080');
  await expect(page.getByTestId('result-card-loss')).toContainText('-0.050');

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(0);
});

test('PROFILE-NOTIFICATIONS waitlist promotion opens its match and becomes read', async ({ page }) => {
  const match = createOpenJoinableMatch({
    id: 'waitlist-promoted-match',
    title: 'Матч после листа ожидания',
    filledSlots: [
      createOpenJoinableMatch().filledSlots[0],
      { id: testUser.id, firstName: 'QA', lastName: 'Player', numericRating: 3.4, isVerified: true, slotIndex: 1 },
    ],
    participants: ['user-owner-1', testUser.id],
  });
  const notification = {
    notification_id: 'waitlist-promoted-notification',
    notification_type: 'waitlist_promoted',
    match_id: match.id,
    invitation_id: null,
    title: 'Вы попали в игру',
    body: 'Для вас освободилось место в матче.',
    data: {},
    created_at: new Date().toISOString(),
    read_at: null,
  };
  const state = await mockSupabase(page, { matches: [match], notifications: [notification] });
  await mockTelegram(page);
  await setAuthenticatedSession(page);
  await page.goto('/');
  await openProfileTab(page);

  await page.getByTestId(`notification-card-${notification.notification_id}`).click();
  await expect(page.getByRole('button', { name: '←' })).toBeVisible();
  await expect(page.getByText(match.title, { exact: true }).first()).toBeVisible();
  expect(state.markNotificationReadRequests).toBe(1);
  await page.getByRole('button', { name: '←' }).click();
  await expect(page.getByTestId('profile-notification-badge')).toHaveCount(0);
});

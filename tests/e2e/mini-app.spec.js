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
    matchUpdates: [],
    messageCreates: [],
  };

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

  await page.locator('button[aria-label]').first().click();
  await expect(page.locator('button').first()).toBeVisible();

  await page.locator('button').first().click();
  await navButtons.nth(2).click();
  await expect(navButtons.nth(2)).toHaveAttribute('aria-current', 'page');

  await navButtons.nth(1).click();
  await expect(navButtons.nth(1)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('QA Player')).toBeVisible();
});

test('allows player to join an open match and persist the slot after reload', async ({ page }) => {
  const supabaseState = await mockSupabase(page, {
    matches: [createOpenJoinableMatch({ title: 'Join smoke match' })],
  });
  await mockTelegram(page);
  await setAuthenticatedSession(page);
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();

  const nav = page.locator('.bottom-nav');

  await nav.getByRole('button').nth(3).click();
  await page.getByText('Join smoke match').click();
  await page.locator('button').last().click();

  await expect.poll(() => supabaseState.matchUpdates.length).toBe(1);
  expect(supabaseState.matches[0].filledSlots).toHaveLength(2);
  expect(supabaseState.matches[0].filledSlots[1]).toMatchObject({
    id: testUser.id,
    firstName: 'QA',
    lastName: 'Player',
    isOrganizer: false,
  });
  expect(supabaseState.matches[0].participants).toContain(testUser.id);

  await page.reload();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await nav.getByRole('button').nth(3).click();
  await page.getByText('Join smoke match').click();

  await expect(page.getByText('QA', { exact: true })).toBeVisible();
});

test('does not crash in a browser without Telegram.WebApp', async ({ page }) => {
  await mockSupabase(page);
  await page.goto('/');

  await expect(page.getByRole('heading').first()).toBeVisible();
  await page.locator('button').first().click();
  await expect(page.getByRole('heading').first()).toBeVisible();
});
test('chat message smoke: sends, scopes and persists a match message', async ({ page }) => {
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

  const nav = page.locator('.bottom-nav');
  const chatButton = page.locator('button').filter({ hasText: /РЎвЂЎР В°РЎвЂљ|С‡Р°С‚|чат/i });

  await nav.getByRole('button').nth(3).click();
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

  await page.locator('.fixed.inset-0 header button').click();
  await page.locator('button').first().click();
  await page.getByText('Other chat match').click();
  await chatButton.click();
  await expect(page.getByText(otherMessageText, { exact: true })).toBeVisible();
  await expect(page.getByText(messageText, { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await nav.getByRole('button').nth(3).click();
  await page.getByText('Chat smoke match').click();
  await chatButton.click();
  await expect(page.getByText(messageText, { exact: true })).toHaveCount(1);
});

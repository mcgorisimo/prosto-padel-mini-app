const { test: base, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

function readEnvFile(fileName) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return {};

  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const [key, ...rest] = line.split('=');
        return [key.trim(), rest.join('=').trim().replace(/^['"]|['"]$/g, '')];
      })
  );
}

const stagingEnv = readEnvFile('.env.staging.local');
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || stagingEnv.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || stagingEnv.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Staging Supabase env is required: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
const SUPABASE_AUTH_KEY = `sb-${projectRef}-auth-token`;

const accounts = {
  organizer_rating_2_0: {
    id: 'e2e-organizer-rating-2-0',
    email: 'organizer_rating_2_0@prostopadel-e2e.test',
    first_name: 'Organizer',
    last_name: 'Two',
    username: 'organizer_rating_2_0',
    rating: 2.0,
    is_verified: true,
    role: 'user',
  },
  player_rating_1_5: {
    id: 'e2e-player-rating-1-5',
    email: 'player_rating_1_5@prostopadel-e2e.test',
    first_name: 'Low',
    last_name: 'Player',
    username: 'player_rating_1_5',
    rating: 1.5,
    is_verified: true,
    role: 'user',
  },
  player_rating_3_0: {
    id: 'e2e-player-rating-3-0',
    email: 'player_rating_3_0@prostopadel-e2e.test',
    first_name: 'Within',
    last_name: 'Player',
    username: 'player_rating_3_0',
    rating: 3.0,
    is_verified: true,
    role: 'user',
  },
  player_rating_4_5: {
    id: 'e2e-player-rating-4-5',
    email: 'player_rating_4_5@prostopadel-e2e.test',
    first_name: 'High',
    last_name: 'Player',
    username: 'player_rating_4_5',
    rating: 4.5,
    is_verified: true,
    role: 'user',
  },
  unverified_player: {
    id: 'e2e-unverified-player',
    email: 'unverified_player@prostopadel-e2e.test',
    first_name: 'Unverified',
    last_name: 'Player',
    username: 'unverified_player',
    rating: 3.0,
    is_verified: false,
    role: 'user',
  },
};

function toAuthUser(account) {
  return {
    id: account.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: account.email,
    user_metadata: {
      first_name: account.first_name,
      last_name: account.last_name,
      username: account.username,
      rating: account.rating,
    },
  };
}

function toProfile(account) {
  return {
    id: account.id,
    first_name: account.first_name,
    last_name: account.last_name,
    username: account.username,
    rating: account.rating,
    is_verified: account.is_verified,
    role: account.role,
    phone: '',
    side_preference: 'Both',
  };
}

function ratingIdxFor(rating) {
  if (rating <= 1.5) return 0;
  if (rating <= 2.2) return 1;
  if (rating <= 3.2) return 2;
  if (rating <= 5.0) return 3;
  if (rating <= 6.5) return 4;
  if (rating <= 7.5) return 5;
  return 6;
}

function slotFor(account, overrides = {}) {
  return {
    id: account.id,
    firstName: account.first_name,
    lastName: account.last_name,
    username: account.username,
    ratingIdx: ratingIdxFor(account.rating),
    numericRating: account.rating,
    isVerified: account.is_verified,
    sidePreference: 'Both',
    isOrganizer: false,
    ...overrides,
  };
}

function tomorrowISO(offset = 1) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function tomorrowLabel(offset = 1) {
  return new Date(tomorrowISO(offset))
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    .replace(' г.', '');
}

function uniqueId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createMatch({ id = uniqueId('e2e-match'), title, owner = accounts.organizer_rating_2_0, isPrivate = false, isRated = false, ratingMin = 2, ratingMax = 5, extraSlots = [], status = 'open' } = {}) {
  const ownerSlot = slotFor(owner, { isOrganizer: true });
  return {
    id,
    owner_id: owner.id,
    ownerId: owner.id,
    date: tomorrowLabel(),
    dateISO: tomorrowISO(),
    time: '19:00',
    duration: 1.5,
    courtId: 'p1',
    courtName: 'Корт 1',
    courtType: 'panoramic',
    isPrime: true,
    type: 'match',
    title: title || id,
    description: id,
    ratingMin,
    ratingMax,
    scenario: isPrivate ? 'private' : 'social',
    status,
    isPrivate,
    is_rating_match: isRated,
    requires_verified_rating: isRated,
    paymentStatus: 'full',
    filledSlots: [ownerSlot, ...extraSlots],
    participants: [owner.id, ...extraSlots.map((slot) => slot.id).filter(Boolean)],
    created_at: new Date().toISOString(),
  };
}

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

async function mockTelegram(page, account) {
  await page.addInitScript((telegramUser) => {
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
        initData: 'query_id=e2e',
        initDataUnsafe: {
          query_id: 'e2e-query',
          user: telegramUser,
        },
        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
        HapticFeedback: { impactOccurred() {}, selectionChanged() {}, notificationOccurred() {} },
        ready() {},
        expand() {},
        close() {},
        sendData() {},
        showConfirm(_message, callback) { callback(true); },
      },
    };
  }, {
    id: Number(account.id.replace(/\D/g, '').slice(0, 9)) || 123456789,
    first_name: account.first_name,
    last_name: account.last_name,
    username: account.username,
    photo_url: '',
  });
}

async function setAuthenticatedSession(page, account) {
  const user = toAuthUser(account);
  await page.addInitScript(({ storageKey, user }) => {
    const encode = (value) => btoa(JSON.stringify(value))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const accessToken = [
      encode({ alg: 'HS256', typ: 'JWT' }),
      encode({ aud: user.aud, exp: expiresAt, sub: user.id, email: user.email, role: user.role }),
      'e2e-signature',
    ].join('.');

    localStorage.setItem(storageKey, JSON.stringify({
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      refresh_token: 'e2e-refresh-token',
      user,
    }));
  }, { storageKey: SUPABASE_AUTH_KEY, user });
}

function filterPublicProfiles(url, profiles) {
  const params = new URL(url).searchParams;
  const idFilter = params.get('id');
  let rows = [...profiles];

  if (idFilter?.startsWith('in.(')) {
    const ids = idFilter.slice(4, -1).split(',').map((id) => id.trim());
    rows = rows.filter((profile) => ids.includes(profile.id));
  }

  const neq = params.get('id')?.startsWith('neq.') ? params.get('id').slice(4) : null;
  if (neq) rows = rows.filter((profile) => profile.id !== neq);

  const or = params.get('or');
  if (or) {
    const raw = or.toLowerCase();
    const termMatch = raw.match(/ilike\.\*?([^*%,)]+)/);
    const term = termMatch?.[1]?.replace(/^@/, '').trim();
    if (term) {
      rows = rows.filter((profile) =>
        [profile.first_name, profile.last_name, profile.username]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term))
      );
    }
  }

  const limit = Number(params.get('limit'));
  return Number.isFinite(limit) && limit > 0 ? rows.slice(0, limit) : rows;
}

async function mockSupabase(page, { currentAccount, matches = [], publicProfiles = Object.values(accounts).map(toProfile), messages = [] }) {
  const state = {
    matches: structuredClone(matches),
    messages: structuredClone(messages),
    publicProfiles: structuredClone(publicProfiles),
    matchUpdates: [],
    messageCreates: [],
  };
  const currentProfile = toProfile(currentAccount);

  await page.route(`${SUPABASE_URL}/auth/v1/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: toAuthUser(currentAccount) }),
    });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/rpc/get_my_profile`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(currentProfile),
    });
  });

  await page.route(`${SUPABASE_URL}/rest/v1/player_public_profiles**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(filterPublicProfiles(route.request().url(), state.publicProfiles)),
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
      const index = state.matches.findIndex((match) => String(match.id) === String(targetId));
      const updated = index >= 0
        ? { ...state.matches[index], ...body }
        : { id: targetId || uniqueId('patched-match'), ...body };

      if (index >= 0) state.matches[index] = updated;
      else state.matches.unshift(updated);
      state.matchUpdates.push({ id: updated.id, body, match: updated });

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([updated]),
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
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      const row = { id: uniqueId('message'), created_at: new Date().toISOString(), ...body };
      state.messages.push(row);
      state.messageCreates.push(row);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([row]) });
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

const test = base.extend({
  page: async ({ page }, use) => {
    const consoleErrors = [];
    const failedNetwork = [];

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('requestfailed', (request) => {
      failedNetwork.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.trim());
    });
    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();
      if (status >= 400 && !url.endsWith('/favicon.ico')) failedNetwork.push(`${status} ${url}`);
    });

    await use(page);

    expect.soft(consoleErrors, 'console errors').toEqual([]);
    expect.soft(failedNetwork, 'failed network requests').toEqual([]);
  },
});

async function openApp(page, { account, matches, publicProfiles } = {}) {
  const state = await mockSupabase(page, {
    currentAccount: account,
    matches,
    publicProfiles,
  });
  await mockTelegram(page, account);
  await setAuthenticatedSession(page, account);
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();
  return state;
}

async function openMatchesTab(page) {
  await page.locator('.bottom-nav').getByRole('button').nth(1).click();
  await expect(page.locator('.bottom-nav').getByRole('button').nth(1)).toHaveAttribute('aria-current', 'page');
}

async function openMatchFromFeed(page, title) {
  await openMatchesTab(page);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByText(title, { exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function openOwnedMatchFromHome(page, title) {
  const row = page.getByText(title, { exact: true }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function clickSelfJoin(page) {
  const joinButton = page.getByRole('button', { name: /Присоединиться к игре|Участие недоступно/ }).last();
  await expect(joinButton).toBeVisible();
  await joinButton.click();
}

async function addPlayerBySearch(page, playerAccount) {
  const emptySlot = page.getByText('Свободно', { exact: true }).first().locator('xpath=..').locator('xpath=./div[1]');
  await emptySlot.click();
  await expect(page.getByText(/Слот \d+ · Свободно/)).toBeVisible();
  await page.getByPlaceholder(/Имя, фамилия или @username/).fill(playerAccount.username);
  const result = page.getByRole('button', { name: new RegExp(`${playerAccount.first_name}\\s+${playerAccount.last_name}`) }).first();
  await expect(result).toBeVisible();
  await result.click();
}

async function expectPlayerPersistedAfterReload(page, title, firstName) {
  await page.reload();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await openMatchesTab(page);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByText(title, { exact: true }).click();
  await expect(page.getByText(firstName, { exact: true })).toBeVisible();
}

function expectParticipant(state, matchId, playerId) {
  const match = state.matches.find((row) => row.id === matchId);
  expect(match?.participants).toContain(playerId);
  expect(match?.filledSlots?.some((slot) => slot?.id === playerId)).toBe(true);
}

function expectNoParticipant(state, matchId, playerId) {
  const match = state.matches.find((row) => row.id === matchId);
  expect(match?.participants || []).not.toContain(playerId);
  expect(match?.filledSlots?.some((slot) => slot?.id === playerId)).toBe(false);
}

test.describe('padel-domain match-joining, invitations and privacy', () => {
  test('SC-008 E2E-JOIN-001 player within level self-joins a public casual match', async ({ page }) => {
    const account = accounts.player_rating_3_0;
    const match = createMatch({ id: uniqueId('sc-008'), title: 'SC-008 public join within' });
    const state = await openApp(page, { account, matches: [match] });

    await openMatchFromFeed(page, match.title);
    await clickSelfJoin(page);

    await expect(page.getByText('Вы присоединились к матчу!')).toBeVisible();
    await expect(page.getByText('Место сохранено в матче')).toBeVisible();
    await expect.poll(() => state.matchUpdates.length).toBe(1);
    expectParticipant(state, match.id, account.id);
    await expectPlayerPersistedAfterReload(page, match.title, account.first_name);
  });

  test('SC-009 E2E-JOIN-002 player below level cannot self-join a public casual match', async ({ page }) => {
    const account = accounts.player_rating_1_5;
    const match = createMatch({ id: uniqueId('sc-009'), title: 'SC-009 public join below', ratingMin: 2, ratingMax: 5 });
    const state = await openApp(page, { account, matches: [match] });

    await openMatchFromFeed(page, match.title);
    const blockedButton = page.getByRole('button', { name: /Участие недоступно/ }).last();
    await expect(blockedButton).toBeVisible();
    await expect(blockedButton).toBeDisabled();
    await expect(page.getByText(/уровень не входит в диапазон/i)).toBeVisible();
    expectNoParticipant(state, match.id, account.id);

    await page.reload();
    await expect(page.locator('.bottom-nav')).toBeVisible();
    expectNoParticipant(state, match.id, account.id);
  });

  test('SC-013 E2E-JOIN-006 player cannot self-join a private match', async ({ page }) => {
    const account = accounts.player_rating_3_0;
    const match = createMatch({ id: uniqueId('sc-013'), title: 'SC-013 private no self join', isPrivate: true, status: 'upcoming' });
    const state = await openApp(page, { account, matches: [match] });

    await openMatchesTab(page);
    await expect(page.getByText(match.title, { exact: true })).toHaveCount(0);
    expectNoParticipant(state, match.id, account.id);

    await page.reload();
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await openMatchesTab(page);
    await expect(page.getByText(match.title, { exact: true })).toHaveCount(0);
  });

  test('SC-014 E2E-INV-001 organizer adds a player within level', async ({ page }) => {
    const organizer = accounts.organizer_rating_2_0;
    const player = accounts.player_rating_3_0;
    const match = createMatch({ id: uniqueId('sc-014'), title: 'SC-014 organizer add within', owner: organizer });
    const state = await openApp(page, { account: organizer, matches: [match] });

    await openMatchFromFeed(page, match.title);
    await addPlayerBySearch(page, player);

    await expect(page.locator('.app-modal-overlay')).toHaveCount(0);
    await expect.poll(() => state.matchUpdates.length).toBe(1);
    expectParticipant(state, match.id, player.id);
    await expectPlayerPersistedAfterReload(page, match.title, player.first_name);
  });

  test('SC-015 E2E-INV-002 organizer adds a player below level after confirmation', async ({ page }) => {
    const organizer = accounts.organizer_rating_2_0;
    const player = accounts.player_rating_1_5;
    const match = createMatch({ id: uniqueId('sc-015'), title: 'SC-015 organizer add below', owner: organizer, ratingMin: 2, ratingMax: 5 });
    const state = await openApp(page, { account: organizer, matches: [match] });

    await openMatchFromFeed(page, match.title);
    await addPlayerBySearch(page, player);

    await expect(page.getByText(/Уровень игрока 1\.5 ниже диапазона матча/)).toBeVisible();
    await page.getByRole('button', { name: 'Добавить' }).click();

    await expect.poll(() => state.matchUpdates.length).toBe(1);
    expectParticipant(state, match.id, player.id);
    await expectPlayerPersistedAfterReload(page, match.title, player.first_name);
  });

  test('SC-019 E2E-INV-006 one player cannot be added twice', async ({ page }) => {
    const organizer = accounts.organizer_rating_2_0;
    const player = accounts.player_rating_3_0;
    const match = createMatch({
      id: uniqueId('sc-019'),
      title: 'SC-019 no duplicate add',
      owner: organizer,
      extraSlots: [slotFor(player)],
    });
    const state = await openApp(page, { account: organizer, matches: [match] });

    await openMatchFromFeed(page, match.title);
    await addPlayerBySearch(page, player);

    await expect(page.getByText(/Этот игрок уже добавлен в матч/)).toBeVisible();
    expect(state.matchUpdates).toHaveLength(0);
    const matchingSlots = state.matches[0].filledSlots.filter((slot) => slot?.id === player.id);
    expect(matchingSlots).toHaveLength(1);
  });

  test('SC-030 E2E-CON-004 match composition is preserved after reload', async ({ page }) => {
    const organizer = accounts.organizer_rating_2_0;
    const player = accounts.player_rating_3_0;
    const match = createMatch({ id: uniqueId('sc-030'), title: 'SC-030 reload composition', owner: organizer });
    const state = await openApp(page, { account: organizer, matches: [match] });

    await openMatchFromFeed(page, match.title);
    await addPlayerBySearch(page, player);

    await expect.poll(() => state.matchUpdates.length).toBe(1);
    expectParticipant(state, match.id, player.id);
    await expectPlayerPersistedAfterReload(page, match.title, player.first_name);
  });

  test('SC-017 E2E-INV-004 rated public match supports manual organizer add', async ({ page }) => {
    const organizer = accounts.organizer_rating_2_0;
    const player = accounts.player_rating_3_0;
    const match = createMatch({ id: uniqueId('sc-017-public'), title: 'SC-017 rated public add', owner: organizer, isRated: true });
    const state = await openApp(page, { account: organizer, matches: [match] });

    await openMatchFromFeed(page, match.title);
    await addPlayerBySearch(page, player);

    await expect.poll(() => state.matchUpdates.length).toBe(1);
    expectParticipant(state, match.id, player.id);
    expect(state.matches[0].is_rating_match).toBe(true);
    await expectPlayerPersistedAfterReload(page, match.title, player.first_name);
  });

  test('SC-017 E2E-INV-004 rated private match supports manual organizer add', async ({ page }) => {
    const organizer = accounts.organizer_rating_2_0;
    const player = accounts.player_rating_3_0;
    const match = createMatch({
      id: uniqueId('sc-017-private'),
      title: 'SC-017 rated private add',
      owner: organizer,
      isPrivate: true,
      isRated: true,
      status: 'upcoming',
    });
    const state = await openApp(page, { account: organizer, matches: [match] });

    await openOwnedMatchFromHome(page, match.title);
    await addPlayerBySearch(page, player);

    await expect.poll(() => state.matchUpdates.length).toBe(1);
    expectParticipant(state, match.id, player.id);
    expect(state.matches[0].isPrivate).toBe(true);
    expect(state.matches[0].is_rating_match).toBe(true);

    await page.reload();
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await openOwnedMatchFromHome(page, match.title);
    await expect(page.getByText(player.first_name, { exact: true })).toBeVisible();
  });

  test('SC-027 E2E-CON-001 concurrent self-join is blocked by missing atomic server join RPC', async ({}) => {
    test.skip(true, 'Blocked: current architecture updates filledSlots/participants JSON with PATCH; no atomic server-side join RPC is available yet.');
  });
});

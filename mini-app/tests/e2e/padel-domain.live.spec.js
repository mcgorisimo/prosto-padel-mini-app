const {
  test,
  expect,
  mockTelegramShell,
  setAuthenticatedSession,
  slotFor,
} = require('./helpers/stagingFixtures');
const { createClient } = require('@supabase/supabase-js');

async function openApp(page, staging, account) {
  await mockTelegramShell(page, account);
  await setAuthenticatedSession(page, staging.config, account);
  await page.goto('/');
  await expect(page.locator('.bottom-nav')).toBeVisible();
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

async function openMatchFromHome(page, title) {
  const matchTitle = page.getByText(title, { exact: true }).first();
  await expect(matchTitle).toBeVisible();
  await matchTitle.click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function addPlayerBySearch(page, playerAccount) {
  await expect(page.locator('[data-testid^="match-empty-slot-"]').first()).toBeVisible();
  await page.locator('[data-testid^="match-empty-slot-"]').first().click();

  await expect(page.getByTestId('player-search-input')).toBeVisible();
  await page.getByTestId('player-search-input').fill(playerAccount.username);

  const result = page.getByTestId(`player-search-result-${playerAccount.id}`);
  await expect(result).toBeVisible();
  await result.click();
}

async function expectPlayerVisibleAfterHomeReload(page, title, firstName) {
  await page.reload();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await openMatchFromHome(page, title);
  await expect(page.getByText(firstName, { exact: true })).toBeVisible();
}

async function expectPlayerRemovedAfterHomeReload(page, title, firstName) {
  await page.reload();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await openMatchFromHome(page, title);
  await expect(page.getByText(firstName, { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-testid^="match-empty-slot-"]').first()).toBeVisible();
}

async function switchLiveAccount(page, staging, account) {
  await mockTelegramShell(page, account);
  await setAuthenticatedSession(page, staging.config, account);
  await page.evaluate(({ storageKey, session }) => {
    localStorage.setItem(storageKey, JSON.stringify(session));
  }, {
    storageKey: staging.config.authStorageKey,
    session: account.session,
  });
  await page.reload();
  await expect(page.locator('.bottom-nav')).toBeVisible();
}

async function expectSelfLeavePersistedInDb(staging, matchId, leaverId, remainingIds, expectedStatus = 'open') {
  await expect.poll(async () => {
    const savedMatch = await staging.getMatch(matchId);
    const participants = Array.isArray(savedMatch.participants) ? savedMatch.participants : [];
    const filledSlots = Array.isArray(savedMatch.filledSlots) ? savedMatch.filledSlots : [];

    const leaverRemoved = !participants.includes(leaverId) && !filledSlots.some((slot) => slot?.id === leaverId);
    const remainingUnchanged = remainingIds.every((id) =>
      participants.includes(id) && filledSlots.some((slot) => slot?.id === id)
    );

    return leaverRemoved && remainingUnchanged && savedMatch.status === expectedStatus;
  }, { message: `Expected self-leave to persist for ${leaverId} in match ${matchId}` }).toBe(true);
}

async function expectPlayerRemovedAfterOrganizerReload(page, staging, organizer, title, firstName) {
  await switchLiveAccount(page, staging, organizer);
  await openMatchFromHome(page, title);
  await expect(page.getByText(firstName, { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-testid^="match-empty-slot-"]').first()).toBeVisible();
}

async function removePlayerFromSlot(page, slotIndex = 1) {
  await page.getByTestId(`match-filled-slot-${slotIndex}`).click();
  const removeButton = page.getByRole('button', { name: 'Убрать из матча' });
  await expect(removeButton).toBeVisible({ timeout: 5000 });
  await removeButton.click();

  const confirmTitle = page.getByText('Удалить игрока?');
  await expect(confirmTitle).toBeVisible();
  await page.getByRole('button', { name: 'Удалить' }).click();
  await expect(confirmTitle).toHaveCount(0);
}

async function leaveOwnSlot(page, slotIndex = 1) {
  await page.getByTestId(`match-filled-slot-${slotIndex}`).click();
  const leaveButton = page.getByTestId('player-slot-remove-action');
  await expect(leaveButton).toBeVisible({ timeout: 5000 });
  await leaveButton.click();

  const confirmModal = page.getByTestId('match-leave-confirm');
  const confirmButton = page.getByTestId('match-leave-confirm-button');
  if (await confirmModal.count()) {
    await expect(confirmModal).toBeVisible();
    await confirmButton.click();
    await expect(confirmModal).toHaveCount(0);
    return;
  }

  const fallbackConfirmTitle = page.getByText('Выйти из матча?');
  await expect(fallbackConfirmTitle).toBeVisible();
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(fallbackConfirmTitle).toHaveCount(0);
}

async function expectSingleParticipantInDb(staging, matchId, userId) {
  const match = await staging.getMatch(matchId);
  const participantCount = (match.participants || []).filter((id) => id === userId).length;
  const slotCount = (match.filledSlots || []).filter((slot) => slot?.id === userId).length;

  expect(participantCount).toBe(1);
  expect(slotCount).toBe(1);
}

function createUserSupabaseClient(staging, account) {
  return createClient(staging.config.url, staging.config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${account.session.access_token}`,
      },
    },
  });
}

async function joinMatchViaRpc(staging, account, matchId) {
  const client = createUserSupabaseClient(staging, account);
  const { data, error } = await client.rpc('join_match', { p_match_id: matchId });
  return { account, data, error };
}

function expectExactlyOneConcurrentJoin(match, contenders) {
  const participants = Array.isArray(match.participants) ? match.participants : [];
  const filledSlots = Array.isArray(match.filledSlots) ? match.filledSlots : [];
  const joined = contenders.filter((account) =>
    participants.includes(account.id) && filledSlots.some((slot) => slot?.id === account.id)
  );

  expect(joined).toHaveLength(1);
  expect(new Set(participants).size).toBe(participants.length);
  expect(filledSlots.filter(Boolean)).toHaveLength(4);

  return joined[0];
}

async function expectPlayerVisibleAfterReload(page, title, firstName) {
  await page.reload();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await openMatchesTab(page);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.getByText(title, { exact: true }).click();
  await expect(page.getByText(firstName, { exact: true })).toBeVisible();
}

async function openAdminPlayersScreen(page) {
  await page.locator('.bottom-nav').getByRole('button').nth(4).click();
  await expect(page.locator('.bottom-nav').getByRole('button').nth(4)).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Админ-панель' }).click();
  await page.getByRole('button').nth(1).click();
  await expect(page.locator('input')).toBeVisible();
}

async function setProfilePhone(staging, account, phone) {
  const { error } = await staging.service
    .from('profiles')
    .update({ phone })
    .eq('id', account.id);
  if (error) throw error;
  return { ...account, phone };
}

async function getProfileSnapshot(staging, profileId) {
  const { data, error } = await staging.service
    .from('profiles')
    .select('id, first_name, last_name, username, role, rating, is_verified, side_preference, created_at')
    .eq('id', profileId)
    .single();
  if (error) throw error;
  return data;
}

async function createTrainingBooking(staging, owner, title) {
  const match = await staging.createMatch({
    owner,
    title,
    isPrivate: true,
    status: 'upcoming',
  });

  const { data, error } = await staging.service
    .from('matches')
    .update({
      type: 'private',
      isPrivate: true,
      isTraining: true,
      trainingStatus: 'pending_coach',
      trainingDetails: {},
    })
    .eq('id', match.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

test.describe('padel-domain live staging E2E @live', () => {
  test('SC-008 @live self-join public match within level', async ({ page, staging }) => {
    const organizer = await staging.createAccount('organizer_rating_2_0');
    const player = await staging.createAccount('player_rating_3_0');
    const match = await staging.createMatch({
      owner: organizer,
      title: 'SC-008 live public join',
      ratingMin: 2,
      ratingMax: 5,
    });

    await openApp(page, staging, player);
    await openMatchFromFeed(page, match.title);

    await expect(page.getByTestId('match-self-join-button')).toBeVisible();
    await page.getByTestId('match-self-join-button').click();

    await expect(page.getByTestId('match-joined-state')).toBeVisible();
    await staging.expectParticipant(match.id, player.id);
    await expectPlayerVisibleAfterReload(page, match.title, player.first_name);
  });

  test('SC-013 @live private match cannot be self-joined from public feed', async ({ page, staging }) => {
    const organizer = await staging.createAccount('organizer_rating_2_0');
    const player = await staging.createAccount('player_rating_3_0');
    const match = await staging.createMatch({
      owner: organizer,
      title: 'SC-013 live private no self join',
      isPrivate: true,
      status: 'open',
      ratingMin: 2,
      ratingMax: 5,
    });

    await openApp(page, staging, player);
    await openMatchesTab(page);
    await expect(page.getByText(match.title, { exact: true })).toHaveCount(0);
    await staging.expectNoParticipant(match.id, player.id);

    await page.reload();
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await openMatchesTab(page);
    await expect(page.getByText(match.title, { exact: true })).toHaveCount(0);
    await staging.expectNoParticipant(match.id, player.id);
  });

  test('SC-015 @live organizer adds below-range player after confirmation', async ({ page, staging }) => {
    const organizer = await staging.createAccount('organizer_rating_2_0');
    const player = await staging.createAccount('player_rating_1_5');
    const match = await staging.createMatch({
      owner: organizer,
      title: 'SC-015 live organizer add below',
      ratingMin: 2,
      ratingMax: 5,
    });

    await openApp(page, staging, organizer);
    await openMatchFromFeed(page, match.title);
    await addPlayerBySearch(page, player);

    await expect(page.getByTestId('level-override-modal')).toBeVisible();
    await page.getByTestId('level-override-confirm').click();

    await staging.expectParticipant(match.id, player.id);
    await expectPlayerVisibleAfterReload(page, match.title, player.first_name);
  });

  test('SC-030 @live match composition persists after reload', async ({ page, staging }) => {
    const organizer = await staging.createAccount('organizer_rating_2_0');
    const player = await staging.createAccount('player_rating_3_0');
    const match = await staging.createMatch({
      owner: organizer,
      title: 'SC-030 live reload composition',
      ratingMin: 2,
      ratingMax: 5,
    });

    await openApp(page, staging, organizer);
    await openMatchFromFeed(page, match.title);
    await addPlayerBySearch(page, player);

    await staging.expectParticipant(match.id, player.id);
    await expectPlayerVisibleAfterReload(page, match.title, player.first_name);

    const reloadedMatch = await staging.getMatch(match.id);
    expect(reloadedMatch.participants).toContain(player.id);
    expect(reloadedMatch.filledSlots.some((slot) => slot?.id === player.id)).toBe(true);
  });

  test('SC-017 E2E-INV-004 @live rated public match allows organizer to add within-level player', async ({ page, staging }) => {
    const organizer = await staging.createAccount('organizer_rating_2_0');
    const player = await staging.createAccount('player_rating_3_0');
    const match = await staging.createMatch({
      owner: organizer,
      title: 'SC-017 live rated public add within',
      isRated: true,
      ratingMin: 2,
      ratingMax: 5,
    });

    await openApp(page, staging, organizer);
    await openMatchFromHome(page, match.title);
    await addPlayerBySearch(page, player);

    await staging.expectParticipant(match.id, player.id);
    await expectPlayerVisibleAfterHomeReload(page, match.title, player.first_name);
  });

  test('SC-018 E2E-INV-005 @live rated public match allows organizer to add below-range player after confirmation', async ({ page, staging }) => {
    const organizer = await staging.createAccount('organizer_rating_2_0');
    const player = await staging.createAccount('player_rating_1_5');
    const match = await staging.createMatch({
      owner: organizer,
      title: 'SC-018 live rated public add below',
      isRated: true,
      ratingMin: 2,
      ratingMax: 5,
    });

    await openApp(page, staging, organizer);
    await openMatchFromHome(page, match.title);
    await addPlayerBySearch(page, player);

    await expect(page.getByTestId('level-override-modal')).toBeVisible();
    await page.getByTestId('level-override-confirm').click();

    await staging.expectParticipant(match.id, player.id);
    await expectPlayerVisibleAfterHomeReload(page, match.title, player.first_name);
  });

  test('SC-017 E2E-INV-004 @live rated private match allows organizer to add within-level player', async ({ page, staging }) => {
    const organizer = await staging.createAccount('organizer_rating_2_0');
    const player = await staging.createAccount('player_rating_3_0');
    const match = await staging.createMatch({
      owner: organizer,
      title: 'SC-017 live rated private add within',
      isPrivate: true,
      isRated: true,
      ratingMin: 2,
      ratingMax: 5,
    });

    await openApp(page, staging, organizer);
    await openMatchFromHome(page, match.title);
    await addPlayerBySearch(page, player);

    await staging.expectParticipant(match.id, player.id);
    await expectPlayerVisibleAfterHomeReload(page, match.title, player.first_name);
  });

  test('SC-018 E2E-INV-005 @live rated private match allows organizer to add below-range player after confirmation', async ({ page, staging }) => {
    const organizer = await staging.createAccount('organizer_rating_2_0');
    const player = await staging.createAccount('player_rating_1_5');
    const match = await staging.createMatch({
      owner: organizer,
      title: 'SC-018 live rated private add below',
      isPrivate: true,
      isRated: true,
      ratingMin: 2,
      ratingMax: 5,
    });

    await openApp(page, staging, organizer);
    await openMatchFromHome(page, match.title);
    await addPlayerBySearch(page, player);

    await expect(page.getByTestId('level-override-modal')).toBeVisible();
    await page.getByTestId('level-override-confirm').click();

    await staging.expectParticipant(match.id, player.id);
    await expectPlayerVisibleAfterHomeReload(page, match.title, player.first_name);
  });

  test('SC-019 E2E-INV-006 @live the same player cannot be added twice', async ({ page, staging }) => {
    const organizer = await staging.createAccount('organizer_rating_2_0');
    const player = await staging.createAccount('player_rating_3_0');
    const match = await staging.createMatch({
      owner: organizer,
      title: 'SC-019 live duplicate player add',
      ratingMin: 2,
      ratingMax: 5,
      extraSlots: [slotFor(player)],
    });

    await openApp(page, staging, organizer);
    await openMatchFromHome(page, match.title);
    await addPlayerBySearch(page, player);

    await expect(page.getByTestId('player-search-input')).toBeVisible();
    await expectSingleParticipantInDb(staging, match.id, player.id);

    await page.reload();
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await openMatchFromHome(page, match.title);
    await expect(page.getByText(player.first_name, { exact: true })).toHaveCount(1);
    await expectSingleParticipantInDb(staging, match.id, player.id);
  });

  test('SC-022 @live participant can leave only their own unpaid match slot', async ({ page, staging }) => {
    const organizer = await staging.createAccount('organizer_rating_2_0');
    const player = await staging.createAccount('player_rating_3_0');
    const match = await staging.createMatch({
      owner: organizer,
      title: 'SC-022 live participant leave',
      ratingMin: 2,
      ratingMax: 5,
      extraSlots: [slotFor(player)],
    });

    await openApp(page, staging, player);
    await openMatchFromHome(page, match.title);
    await leaveOwnSlot(page, 1);

    await expectSelfLeavePersistedInDb(staging, match.id, player.id, [organizer.id], 'open');
    await expectPlayerRemovedAfterOrganizerReload(page, staging, organizer, match.title, player.first_name);
  });

  test('SC-024 E2E-PERM-001 @live organizer removes invited unpaid participant', async ({ page, staging }) => {
    const organizer = await staging.createAccount('organizer_rating_2_0');
    const player = await staging.createAccount('player_rating_3_0');
    const match = await staging.createMatch({
      owner: organizer,
      title: 'SC-024 live organizer remove player',
      ratingMin: 2,
      ratingMax: 5,
      extraSlots: [slotFor(player)],
    });

    await openApp(page, staging, organizer);
    await openMatchFromHome(page, match.title);
    await removePlayerFromSlot(page, 1);

    await staging.expectNoParticipant(match.id, player.id);
    await expectPlayerRemovedAfterHomeReload(page, match.title, player.first_name);
  });

  test('SC-027 E2E-CON-001 @live concurrent self-join allows exactly one player to take the last slot', async ({ browser, staging }) => {
    const organizer = await staging.createAccount('organizer_rating_2_0');
    const existingOne = await staging.createAccount('player_rating_3_0', {
      first_name: 'LiveExistingOne',
      username: 'live_existing_one_3_0',
    });
    const existingTwo = await staging.createAccount('player_rating_3_0', {
      first_name: 'LiveExistingTwo',
      username: 'live_existing_two_3_0',
    });
    const contenderOne = await staging.createAccount('player_rating_3_0', {
      first_name: 'LiveContenderOne',
      username: 'live_contender_one_3_0',
    });
    const contenderTwo = await staging.createAccount('player_rating_3_0', {
      first_name: 'LiveContenderTwo',
      username: 'live_contender_two_3_0',
    });
    const match = await staging.createMatch({
      owner: organizer,
      title: 'SC-027 live concurrent last slot',
      ratingMin: 2,
      ratingMax: 5,
      extraSlots: [slotFor(existingOne), slotFor(existingTwo)],
    });

    const [firstAttempt, secondAttempt] = await Promise.all([
      joinMatchViaRpc(staging, contenderOne, match.id),
      joinMatchViaRpc(staging, contenderTwo, match.id),
    ]);
    const attempts = [firstAttempt, secondAttempt];
    const successes = attempts.filter((attempt) => !attempt.error);
    const failures = attempts.filter((attempt) => attempt.error);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const savedMatch = await staging.getMatch(match.id);
    const winner = expectExactlyOneConcurrentJoin(savedMatch, [contenderOne, contenderTwo]);
    const loser = winner.id === contenderOne.id ? contenderTwo : contenderOne;

    expect(savedMatch.participants).not.toContain(loser.id);
    expect(savedMatch.filledSlots.some((slot) => slot?.id === loser.id)).toBe(false);

    const page = await browser.newPage();
    try {
      await openApp(page, staging, winner);
      await openMatchFromFeed(page, match.title);
      await expect(page.getByTestId('match-joined-state')).toBeVisible();
      await expect(page.getByText(winner.first_name, { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.locator('.bottom-nav')).toBeVisible();
      await openMatchFromFeed(page, match.title);
      await expect(page.getByText(winner.first_name, { exact: true })).toBeVisible();
      await expect(page.getByText(loser.first_name, { exact: true })).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test('SC-040 @live profiles read api admin player list supports search and filters', async ({ page, staging }) => {
    const admin = await staging.createAccount('player_rating_3_0', {
      first_name: 'LiveAdminRead',
      username: 'live_admin_read',
      role: 'admin',
      is_verified: true,
    });
    const verified = await setProfilePhone(staging, await staging.createAccount('player_rating_3_0', {
      first_name: 'LiveVerifiedRead',
      username: 'live_verified_read',
      is_verified: true,
    }), '+155500401');
    const unverified = await setProfilePhone(staging, await staging.createAccount('player_rating_1_5', {
      first_name: 'LiveUnverifiedRead',
      username: 'live_unverified_read',
      is_verified: false,
    }), '+155500402');

    await openApp(page, staging, admin);
    await openAdminPlayersScreen(page);

    await expect(page.getByText(verified.first_name, { exact: false })).toBeVisible();
    await expect(page.getByText(verified.phone, { exact: false })).toBeVisible();
    const verifiedCard = page
      .getByText(verified.phone, { exact: false })
      .locator('xpath=ancestor::div[.//button][1]');
    await expect(verifiedCard.getByText('3.00', { exact: true })).toBeVisible();
    await expect(page.getByText('user', { exact: false }).first()).toBeVisible();

    await page.locator('input').fill(verified.first_name);
    await expect(page.getByText(verified.first_name, { exact: false })).toBeVisible();
    await expect(page.getByText(unverified.first_name, { exact: false })).toHaveCount(0);

    await page.locator('input').fill(verified.phone);
    await expect(page.getByText(verified.first_name, { exact: false })).toBeVisible();
    await expect(page.getByText(verified.phone, { exact: false })).toBeVisible();

    await page.locator('input').fill('');
    await page.getByRole('button').nth(2).click();
    await expect(page.getByText(unverified.first_name, { exact: false })).toBeVisible();
    await expect(page.getByText(verified.first_name, { exact: false })).toHaveCount(0);

    await page.getByRole('button').nth(3).click();
    await expect(page.getByText(verified.first_name, { exact: false })).toBeVisible();
    await expect(page.getByText(unverified.first_name, { exact: false })).toHaveCount(0);
  });

  test('SC-041 @live profiles read api rejects admin RPC for regular authenticated users', async ({ staging }) => {
    const regular = await staging.createAccount('player_rating_3_0', {
      first_name: 'LiveRegularRpc',
      username: 'live_regular_rpc',
    });
    await setProfilePhone(staging, regular, '+155500411');

    const client = createUserSupabaseClient(staging, regular);
    const { data, error } = await client.rpc('admin_list_profiles', {
      p_search: null,
      p_filter: 'all',
    });

    expect(error).toBeTruthy();
    expect(data == null || data.length === 0).toBe(true);
    expect(JSON.stringify(data ?? '')).not.toContain('+155500411');
  });

  test('SC-044 @live profiles read lockdown hides foreign profile rows from regular users', async ({ staging }) => {
    const reader = await staging.createAccount('player_rating_3_0', {
      first_name: 'LiveReaderLockdown',
      username: 'live_reader_lockdown',
    });
    const target = await setProfilePhone(staging, await staging.createAccount('player_rating_3_0', {
      first_name: 'LiveForeignLockdown',
      username: 'live_foreign_lockdown',
    }), '+155500441');

    const client = createUserSupabaseClient(staging, reader);
    const { data, error } = await client
      .from('profiles')
      .select('id, phone, email, role, birthday, created_at')
      .eq('id', target.id);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
    expect(JSON.stringify(data ?? '')).not.toContain('+155500441');
    expect(JSON.stringify(data ?? '')).not.toContain(target.email);
    expect(JSON.stringify(data ?? '')).not.toContain('user');
  });

  test('SC-045 @live profiles read lockdown allows own profile update through UI', async ({ page, staging }) => {
    const player = await staging.createAccount('player_rating_3_0', {
      first_name: 'LiveOwnBefore',
      last_name: 'Profile',
      username: 'live_own_profile',
      side_preference: 'Both',
      role: 'user',
      is_verified: true,
    });
    const before = await getProfileSnapshot(staging, player.id);
    const nextFirstName = 'LiveOwnAfter';
    const nextLastName = 'Updated';

    await openApp(page, staging, player);
    await page.locator('.bottom-nav').getByRole('button').nth(4).click();
    await expect(page.locator('.bottom-nav').getByRole('button').nth(4)).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(before.first_name, { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'Настройки' }).click();
    await page.getByRole('button', { name: /Личная информация/ }).click();

    const inputs = page.locator('input');
    await expect(inputs.nth(0)).toHaveValue(before.first_name);
    await expect(inputs.nth(1)).toHaveValue(before.last_name);
    await expect(inputs.nth(3)).toBeDisabled();
    await expect(inputs.nth(3)).toHaveValue(`@${before.username}`);

    await inputs.nth(0).fill(nextFirstName);
    await inputs.nth(1).fill(nextLastName);
    const sideButtons = page.locator('label').filter({ has: page.locator('button') }).getByRole('button');
    await sideButtons.nth(2).click();

    const updateRpc = page.waitForResponse((response) =>
      response.url().includes('/rest/v1/rpc/update_my_profile') &&
      response.request().method() === 'POST'
    );
    await page.locator('button').last().click();
    const rpcResponse = await updateRpc;
    expect(rpcResponse.ok()).toBe(true);

    await expect.poll(async () => {
      const profile = await getProfileSnapshot(staging, player.id);
      return {
        first_name: profile.first_name,
        last_name: profile.last_name,
        side_preference: profile.side_preference,
      };
    }, { message: 'Expected own profile update to persist' }).toEqual({
      first_name: nextFirstName,
      last_name: nextLastName,
      side_preference: 'Right',
    });

    const after = await getProfileSnapshot(staging, player.id);
    expect(after.id).toBe(before.id);
    expect(after.username).toBe(before.username);
    expect(after.role).toBe(before.role);
    expect(Number(after.rating)).toBe(Number(before.rating));
    expect(after.is_verified).toBe(before.is_verified);
    expect(after.created_at).toBe(before.created_at);

    await page.reload();
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await page.locator('.bottom-nav').getByRole('button').nth(4).click();
    await expect(page.getByText(nextFirstName, { exact: false })).toBeVisible();
    await expect(page.getByText(nextLastName, { exact: false })).toBeVisible();
  });

  test('SC-042 @live profiles read api training modal uses public player search only', async ({ page, staging }) => {
    const owner = await staging.createAccount('player_rating_3_0', {
      first_name: 'LiveTrainingOwner',
      username: 'live_training_owner',
    });
    const participant = await setProfilePhone(staging, await staging.createAccount('player_rating_3_0', {
      first_name: 'LiveTrainingTarget',
      username: 'live_training_target',
    }), '+155500421');
    const match = await createTrainingBooking(staging, owner, 'SC-042 live training public profile search');

    await openApp(page, staging, owner);
    const trainingTitle = page.getByText(match.title, { exact: true }).first();
    await expect(trainingTitle).toBeVisible();
    await trainingTitle.click();

    const modal = page.locator('.app-modal-panel');
    await expect(modal).toBeVisible();
    await modal.getByRole('button').filter({ hasText: '2' }).first().click();

    const input = modal.locator('input').first();
    await input.fill(participant.first_name);
    await expect(modal.getByText(participant.first_name, { exact: false })).toBeVisible();
    await expect(modal.getByText(participant.phone, { exact: false })).toHaveCount(0);

    await input.fill(participant.username);
    await expect(modal.getByText(participant.first_name, { exact: false })).toBeVisible();
    await expect(modal.getByText(participant.phone, { exact: false })).toHaveCount(0);
    await modal.getByText(participant.first_name, { exact: false }).click();

    await expect(modal.getByText(participant.first_name, { exact: false })).toBeVisible();
    const modalButtons = modal.getByRole('button');
    await modalButtons.nth(await modalButtons.count() - 2).click();

    await expect.poll(async () => {
      const saved = await staging.getMatch(match.id);
      const guests = saved.trainingDetails?.guests ?? saved.trainingDetails?.guests ?? [];
      return Array.isArray(guests) && guests.some((guest) => guest?.id === participant.id);
    }, { message: 'Expected selected training guest id to be persisted' }).toBe(true);
  });

  test('SC-043 @live profiles read api registration creates safe user profile', async ({ page, staging }) => {
    const suffix = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`.toLowerCase();
    const username = `live_signup_${suffix}`.slice(0, 60);
    const email = `${username}@prostopadel-e2e.test`;
    const password = `E2E-${suffix}-Aa1!`;
    let createdProfileId = null;

    try {
      await mockTelegramShell(page, {
        first_name: 'LiveSignup',
        last_name: 'User',
        username,
      });
      await page.goto('/');
      await page.locator('button').first().click();

      const inputs = page.locator('input');
      await inputs.nth(0).fill('LiveSignup');
      await inputs.nth(1).fill('User');
      await inputs.nth(2).fill(email);
      await inputs.nth(3).fill(`@${username}`);
      await inputs.nth(4).fill(password);
      await page.locator('button').last().click();

      await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 20000 });

      const { data: profile, error } = await staging.service
        .from('profiles')
        .select('id, first_name, last_name, username, role, rating, is_verified')
        .eq('username', username)
        .single();
      if (error) throw error;
      createdProfileId = profile.id;
      staging.createdUserIds.push(profile.id);

      expect(profile.role).toBe('user');
      expect(profile.is_verified).toBe(false);
      expect(Number(profile.rating)).toBeGreaterThanOrEqual(0);
      expect(Number(profile.rating)).toBeLessThanOrEqual(10);

      await expect(page.getByText('LiveSignup', { exact: false })).toBeVisible();
    } finally {
      if (createdProfileId && !staging.createdUserIds.includes(createdProfileId)) {
        staging.createdUserIds.push(createdProfileId);
      }
    }
  });
});

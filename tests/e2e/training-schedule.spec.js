const { test, expect } = require('@playwright/test');

const CREDENTIAL = 'A'.repeat(43);
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CLOSED = { outcome: 'not_configured', sessions: [] };

async function prepare(page, schedule = () => ({ status: 200, body: CLOSED })) {
  const requests = [];
  const providerRequests = [];
  page.on('request', (request) => {
    if (/yclients|yplaces|supabase/iu.test(request.url())) providerRequests.push(request.url());
  });
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(() => {
    sessionStorage.setItem('prosto-padel-splash-shown', 'true');
    window.__trainingBack = null;
    window.Telegram = { WebApp: {
      initData: 'query_id=training-test&auth_date=1700000000&hash=synthetic',
      initDataUnsafe: { user: { id: 123, first_name: 'Synthetic' } },
      ready() {}, expand() {}, disableVerticalSwipes() {},
      HapticFeedback: { impactOccurred() {} },
      BackButton: { show() {}, hide() {}, onClick(fn) { window.__trainingBack = fn; }, offClick() { window.__trainingBack = null; } },
    } };
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    requests.push({ path, search: url.search, method: request.method(), authorization: request.headers().authorization });
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    let body;
    let status = 200;
    if (path === '/api/v1/auth/telegram/login') body = { credential: CREDENTIAL, expiresAt, accountKind: 'existing' };
    else if (path === '/api/v1/auth/session/me') body = { accountId: ACCOUNT, role: 'player', expiresAt };
    else if (path === '/api/v1/profile/me') body = { accountId: ACCOUNT, role: 'player', firstName: 'Synthetic', lastName: 'Player', username: null, photoUrl: null, languageCode: 'ru', phone: null, sidePreference: null };
    else if (path === '/api/v1/onboarding/me') body = { status: 'completed', legalPolicyCurrent: true, initialLevelLabel: 'D+', initialLevelAlgorithmVersion: 'initial_level_v2' };
    else if (path === '/api/v1/onboarding/me/initial-level-reassessment') body = { status: 'not_eligible' };
    else if (path === '/api/v1/trainings/schedule') ({ status, body } = schedule());
    else if (path === '/api/v1/bookings') body = { reservations: [] };
    else { status = 503; body = { statusCode: 503, code: 'fixture_unavailable', message: 'Unavailable' }; }
    await route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Групповые тренировки', exact: true })).toBeVisible();
  return { requests, providerRequests };
}

for (const viewport of [{ width: 375, height: 667 }, { width: 667, height: 375 }]) {
  test(`real Home opens closed group schedule and returns with five tabs ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { requests, providerRequests } = await prepare(page);
    const tabs = page.locator('.bottom-nav button');
    await expect(tabs).toHaveCount(5);
    const matchTab = page.getByRole('button', { name: 'Матчи', exact: true });
    const matchIcon = matchTab.locator('svg');
    await expect(matchIcon).toHaveAttribute('data-padel-icon', 'matches');
    await expect(matchIcon).toHaveAttribute('stroke', 'currentColor');
    await expect(matchIcon).toHaveAttribute('stroke-width', '1.9');
    const inactiveColor = await matchIcon.evaluate((svg) => getComputedStyle(svg).color);
    await matchTab.click();
    await expect(matchTab).toHaveAttribute('aria-current', 'page');
    await expect(matchIcon).toHaveAttribute('stroke-width', '2.4');
    await expect.poll(() => matchIcon.evaluate((svg) => getComputedStyle(svg).color)).not.toBe(inactiveColor);
    expect(await matchIcon.evaluate((svg) => getComputedStyle(svg).stroke === getComputedStyle(svg).color)).toBe(true);
    const matchBox = await matchTab.boundingBox();
    expect(matchBox.width).toBeGreaterThanOrEqual(44);
    expect(matchBox.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: 'Главная', exact: true }).click();
    const trainingFilter = page.getByRole('button', { name: 'Тренировки 0', exact: true });
    await expect(trainingFilter.locator('svg')).toHaveAttribute('data-padel-icon', 'trainings');
    await trainingFilter.click();
    await expect(trainingFilter).toHaveAttribute('aria-pressed', 'true');
    expect(await trainingFilter.locator('svg').evaluate((svg) => getComputedStyle(svg).stroke === getComputedStyle(svg).color)).toBe(true);
    await page.getByRole('button', { name: 'Все 0', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Групповые тренировки', exact: true }).locator('svg')).toHaveAttribute('data-padel-icon', 'trainings');
    await expect(page.locator('.lucide-dumbbell')).toHaveCount(0);
    await expect(page.locator('.lucide-swords')).toHaveCount(0);
    await expect(page.locator('[data-padel-icon="matches"]')).toHaveCount(2);
    await expect(page.getByText('ТРЦ «Отрада»')).toHaveCount(0);
    await expect(page.getByText('Пятницкое ш.', { exact: false })).toHaveCount(0);
    await expect(page.getByTestId('home-player-level-value')).toHaveCount(0);
    await expect(page.getByText('Ближайшее событие', { exact: true })).toHaveCount(0);
    const eventsBox = await page.getByRole('heading', { name: 'Мои события' }).boundingBox();
    const groupBox = await page.getByRole('button', { name: 'Групповые тренировки', exact: true }).boundingBox();
    expect(eventsBox.y).toBeLessThan(groupBox.y);
    expect(groupBox.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByText('Вход через Telegram подтверждён: аккаунт найден.', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
    expect(requests.filter((r) => r.path === '/api/v1/trainings/schedule')).toHaveLength(0);
    await page.getByRole('button', { name: 'Групповые тренировки', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Групповые тренировки', exact: true })).toBeVisible();
    await expect(page.getByText('Расписание групповых занятий скоро появится')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('training.png'), fullPage: true });
    await expect(tabs).toHaveCount(0);
    await expect(page.getByRole('button', { name: /записаться|оплатить|абонемент/iu })).toHaveCount(0);
    expect(requests.filter((r) => r.path === '/api/v1/trainings/schedule')).toEqual([{ path: '/api/v1/trainings/schedule', search: '', method: 'GET', authorization: `Bearer ${CREDENTIAL}` }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const backBox = await page.getByRole('button', { name: 'Назад', exact: true }).boundingBox();
    expect(backBox.width).toBeGreaterThanOrEqual(44);
    expect(backBox.height).toBeGreaterThanOrEqual(44);
    if (viewport.width === 375) await page.getByRole('button', { name: 'Назад', exact: true }).click();
    else await page.evaluate(() => window.__trainingBack());
    await expect(tabs).toHaveCount(5);
    await expect(page.getByRole('button', { name: 'Групповые тренировки', exact: true })).toBeVisible();
    await tabs.getByText('Рейтинг', { exact: true }).click();
    await expect(page.locator('.bottom-nav button[aria-current="page"]')).toHaveText('Рейтинг');
    await tabs.getByText('Профиль', { exact: true }).click();
    await expect(page.getByTestId('profile-player-level-summary')).toContainText('2.00 · D+');
    expect(providerRequests).toEqual([]);
    expect(requests.filter((r) => r.method !== 'GET' && r.path !== '/api/v1/auth/telegram/login')).toEqual([]);
  });
}

test('schedule errors and unapproved rows stay separate from not_configured, with a working retry', async ({ page }) => {
  let attempts = 0;
  await prepare(page, () => {
    attempts += 1;
    return attempts === 1 ? { status: 503, body: {} }
      : attempts === 2 ? { status: 200, body: { outcome: 'loaded', sessions: [{ title: 'SYNTHETIC_PRIVATE_MARKER' }] } }
        : { status: 200, body: CLOSED };
  });
  await page.getByRole('button', { name: 'Групповые тренировки', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить расписание');
  await expect(page.getByText('Расписание групповых занятий скоро появится')).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('SYNTHETIC_PRIVATE_MARKER')).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByText('Расписание групповых занятий скоро появится')).toBeVisible();
  expect(attempts).toBe(3);
});

test('401 on schedule closes the authenticated App through the existing session lifecycle', async ({ page }) => {
  await prepare(page, () => ({ status: 401, body: { code: 'session_invalid' } }));
  await page.getByRole('button', { name: 'Групповые тренировки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Групповые тренировки', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('backend-own-profile-gate')).toHaveAttribute('data-state', 'loading');
});

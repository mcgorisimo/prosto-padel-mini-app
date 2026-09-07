const { test, expect } = require('@playwright/test');

const CREDENTIAL = 'A'.repeat(43);
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CLOSED_MINE = { outcome: 'not_configured', memberships: [] };
const CLOSED_CATALOG = { outcome: 'not_configured', products: [] };

async function prepare(page, {
  mine = () => ({ status: 200, body: CLOSED_MINE }),
  catalog = () => ({ status: 200, body: CLOSED_CATALOG }),
} = {}) {
  const requests = [];
  const providerRequests = [];
  page.on('request', (request) => {
    if (/yclients|yplaces|supabase/iu.test(request.url())) providerRequests.push(request.url());
  });
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '',
  }));
  await page.addInitScript(() => {
    sessionStorage.setItem('prosto-padel-splash-shown', 'true');
    window.__membershipBack = null;
    window.Telegram = { WebApp: {
      initData: 'query_id=membership-test&auth_date=1700000000&hash=synthetic',
      initDataUnsafe: { user: { id: 123, first_name: 'Synthetic' } },
      ready() {}, expand() {}, disableVerticalSwipes() {},
      HapticFeedback: { impactOccurred() {} },
      BackButton: {
        show() {}, hide() {},
        onClick(fn) { window.__membershipBack = fn; },
        offClick() { window.__membershipBack = null; },
      },
    } };
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    requests.push({
      path,
      search: url.search,
      method: request.method(),
      authorization: request.headers().authorization,
    });
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    let body;
    let status = 200;
    if (path === '/api/v1/auth/telegram/login') body = { credential: CREDENTIAL, expiresAt, accountKind: 'existing' };
    else if (path === '/api/v1/auth/session/me') body = { accountId: ACCOUNT, role: 'player', expiresAt };
    else if (path === '/api/v1/profile/me') body = { accountId: ACCOUNT, role: 'player', firstName: 'Synthetic', lastName: 'Player', username: null, photoUrl: null, languageCode: 'ru', phone: null, sidePreference: null };
    else if (path === '/api/v1/onboarding/me') body = { status: 'completed', legalPolicyCurrent: true, initialLevelLabel: 'D+', initialLevelAlgorithmVersion: 'initial_level_v2' };
    else if (path === '/api/v1/onboarding/me/initial-level-reassessment') body = { status: 'not_eligible' };
    else if (path === '/api/v1/memberships/mine') ({ status, body } = mine());
    else if (path === '/api/v1/memberships/catalog') ({ status, body } = catalog());
    else if (path === '/api/v1/bookings') body = { reservations: [] };
    else { status = 503; body = { statusCode: 503, code: 'fixture_unavailable', message: 'Unavailable' }; }
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(body),
    });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Абонементы', exact: true })).toBeVisible();
  return { requests, providerRequests };
}

for (const viewport of [{ width: 375, height: 667 }, { width: 667, height: 375 }]) {
  test(`Home opens closed memberships with equal CTAs and returns ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { requests, providerRequests } = await prepare(page);
    const tabs = page.locator('.bottom-nav button');
    await expect(tabs).toHaveCount(5);
    const training = page.getByRole('button', { name: 'Групповые тренировки', exact: true });
    const memberships = page.getByRole('button', { name: 'Абонементы', exact: true });
    await expect(training.locator('svg')).toHaveCount(0);
    await expect(memberships.locator('svg')).toHaveCount(0);
    const trainingBox = await training.boundingBox();
    const membershipBox = await memberships.boundingBox();
    expect(Math.abs(trainingBox.y - membershipBox.y)).toBeLessThan(1);
    expect(Math.abs(trainingBox.width - membershipBox.width)).toBeLessThan(1);
    expect(Math.abs(trainingBox.height - membershipBox.height)).toBeLessThan(1);
    expect(trainingBox.height).toBeLessThanOrEqual(72);
    expect(trainingBox.height).toBeGreaterThanOrEqual(44);
    expect(membershipBox.width).toBeGreaterThanOrEqual(44);
    expect(membershipBox.height).toBeGreaterThanOrEqual(44);
    const trainingStyles = await training.evaluate((button) => ({
      backgroundColor: getComputedStyle(button).backgroundColor,
      color: getComputedStyle(button).color,
      paddingTop: getComputedStyle(button).paddingTop,
      paddingBottom: getComputedStyle(button).paddingBottom,
      borderRadius: getComputedStyle(button).borderRadius,
    }));
    expect(trainingStyles).toEqual({
      backgroundColor: 'rgb(0, 83, 135)',
      color: 'rgb(255, 255, 255)',
      paddingTop: '8px',
      paddingBottom: '8px',
      borderRadius: '12px',
    });
    expect(await training.evaluate((button) => getComputedStyle(button.parentElement).columnGap)).toBe('8px');
    expect(await memberships.evaluate((button) => ({
      backgroundColor: getComputedStyle(button).backgroundColor,
      borderColor: getComputedStyle(button).borderTopColor,
      borderWidth: getComputedStyle(button).borderTopWidth,
      color: getComputedStyle(button).color,
    }))).toEqual({
      backgroundColor: 'rgb(46, 86, 86)',
      borderColor: 'rgba(245, 241, 232, 0.18)',
      borderWidth: '1px',
      color: 'rgb(255, 255, 255)',
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByText('Вход через Telegram подтверждён: аккаунт найден.', { exact: true })).toHaveCount(0);
    await memberships.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('home-membership-cta.png'), fullPage: true });

    expect(requests.filter((request) => request.path.startsWith('/api/v1/memberships/'))).toEqual([]);
    await memberships.click();
    await expect(page.getByRole('heading', { name: 'Абонементы', exact: true })).toBeVisible();
    await expect(tabs).toHaveCount(0);
    const mineTab = page.getByRole('tab', { name: 'Мои абонементы', exact: true });
    const catalogTab = page.getByRole('tab', { name: 'Купить абонемент', exact: true });
    await expect(mineTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Проверка абонементов пока недоступна')).toBeVisible();
    await expect(page.locator('[data-padel-icon="memberships"]')).toHaveCount(0);
    expect(requests.filter((request) => request.path === '/api/v1/memberships/mine')).toEqual([{
      path: '/api/v1/memberships/mine', search: '', method: 'GET', authorization: `Bearer ${CREDENTIAL}`,
    }]);
    expect(requests.filter((request) => request.path === '/api/v1/memberships/catalog')).toEqual([]);
    for (const control of [page.getByRole('button', { name: 'Назад', exact: true }), mineTab, catalogTab]) {
      const box = await control.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: testInfo.outputPath('memberships-mine.png'), fullPage: true });

    await catalogTab.click();
    await expect(catalogTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Каталог пока недоступен')).toBeVisible();
    expect(requests.filter((request) => request.path === '/api/v1/memberships/catalog')).toEqual([{
      path: '/api/v1/memberships/catalog', search: '', method: 'GET', authorization: `Bearer ${CREDENTIAL}`,
    }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('memberships-catalog.png'), fullPage: true });

    if (viewport.width === 375) await page.getByRole('button', { name: 'Назад', exact: true }).click();
    else await page.evaluate(() => window.__membershipBack());
    await expect(tabs).toHaveCount(5);
    await expect(memberships).toBeVisible();
    expect(providerRequests).toEqual([]);
    expect(requests.filter((request) => request.method !== 'GET' && request.path !== '/api/v1/auth/telegram/login')).toEqual([]);
  });
}

test('memberships distinguishes unavailable, retry, empty and catalog empty', async ({ page }) => {
  let attempts = 0;
  await prepare(page, {
    mine: () => {
      attempts += 1;
      return attempts === 1
        ? { status: 503, body: {} }
        : { status: 200, body: { outcome: 'loaded', memberships: [] } };
    },
    catalog: () => ({ status: 200, body: { outcome: 'loaded', products: [] } }),
  });
  await page.getByRole('button', { name: 'Абонементы', exact: true }).click();
  await expect(page.getByText('Сервис временно недоступен')).toBeVisible();
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByText('У вас пока нет абонементов')).toBeVisible();
  expect(attempts).toBe(2);
  await page.getByRole('tab', { name: 'Купить абонемент', exact: true }).click();
  await expect(page.getByText('Сейчас нет доступных абонементов')).toBeVisible();
  await expect(page.getByRole('button', { name: /купить|оплатить|оформить/iu })).toHaveCount(0);
});

test('unexpected membership PII is rejected without rendering or logging it', async ({ page }) => {
  const marker = 'SYNTHETIC_PRIVATE_MARKER';
  const pageErrors = [];
  page.on('console', (message) => pageErrors.push(message.text()));
  await prepare(page, {
    mine: () => ({ status: 200, body: { outcome: 'loaded', memberships: [{
      id: '11111111-1111-4111-8111-111111111111', title: 'Закрытый', status: 'active', remainingVisits: 4, expiresOn: '2035-10-05', phone: marker,
    }] } }),
  });
  await page.getByRole('button', { name: 'Абонементы', exact: true }).click();
  await expect(page.getByText('Не удалось загрузить данные')).toBeVisible();
  await expect(page.getByText(marker)).toHaveCount(0);
  expect(pageErrors.join('\n')).not.toContain(marker);
});

test('401 on own memberships closes the authenticated App through the existing lifecycle', async ({ page }) => {
  await prepare(page, { mine: () => ({ status: 401, body: { code: 'session_invalid' } }) });
  await page.getByRole('button', { name: 'Абонементы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Абонементы', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('backend-own-profile-gate')).toHaveAttribute('data-state', 'loading');
});

const { test, expect } = require('@playwright/test');

const CREDENTIAL = 'A'.repeat(43);
const ACCOUNT = '11111111-1111-4111-8111-111111111111';

async function expectIconInsideViewBox(icon) {
  const bounds = await icon.evaluate((svg) => {
    const inverse = svg.getScreenCTM().inverse();
    const result = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const shape of svg.querySelectorAll('path, circle, ellipse, rect')) {
      const matrix = inverse.multiply(shape.getScreenCTM());
      const style = getComputedStyle(shape);
      const radius = style.stroke === 'none' ? 0 : parseFloat(style.strokeWidth) / 2;
      const radiusX = radius * Math.hypot(matrix.a, matrix.c);
      const radiusY = radius * Math.hypot(matrix.b, matrix.d);
      const length = shape.getTotalLength();
      for (let step = 0; step <= 180; step += 1) {
        const point = shape.getPointAtLength(length * step / 180).matrixTransform(matrix);
        result.left = Math.min(result.left, point.x - radiusX);
        result.top = Math.min(result.top, point.y - radiusY);
        result.right = Math.max(result.right, point.x + radiusX);
        result.bottom = Math.max(result.bottom, point.y + radiusY);
      }
    }
    return result;
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(24);
  expect(bounds.bottom).toBeLessThanOrEqual(24);
}

async function expectBookingPalette(icon) {
  await expect(icon).toHaveAttribute('data-padel-icon', 'bookings');
  await expect(icon.locator('[data-padel-part="calendar"]')).toHaveAttribute('stroke', '#F5F1E8');
  await expect(icon.locator('[data-padel-part="ball"] circle')).toHaveAttribute('fill', '#78B83F');
  await expect(icon.locator('[data-padel-part="ball"] g')).toHaveAttribute('stroke', '#F5F1E8');
  await expect(icon.locator('[data-padel-part="ball"] path')).toHaveCount(2);
  await expectIconInsideViewBox(icon);
}

async function expectMatchComposition(icon) {
  await expect(icon).toHaveAttribute('data-padel-icon', 'matches');
  await expect(icon.locator('[data-padel-part="racket"]')).toHaveCount(2);
  await expect(icon.locator('[data-padel-part="head-outline"]')).toHaveCount(2);
  await expect(icon.locator('[data-padel-part="ball"] circle')).toHaveCount(1);
  await expectIconInsideViewBox(icon);
}

async function prepare(page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '',
  }));
  await page.addInitScript(() => {
    sessionStorage.setItem('prosto-padel-splash-shown', 'true');
    window.Telegram = { WebApp: {
      initData: 'query_id=icon-test&auth_date=1700000000&hash=synthetic',
      initDataUnsafe: { user: { id: 123, first_name: 'Synthetic' } },
      ready() {}, expand() {}, disableVerticalSwipes() {},
      HapticFeedback: { impactOccurred() {} },
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
    } };
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const match = {
      matchId: '22222222-2222-4222-8222-222222222222',
      ownerAccountId: ACCOUNT,
      startsAt: Math.floor(Date.now() / 1000) + 86400,
      durationMinutes: 90,
      courtId: 'court-1',
      courtName: 'Корт 1',
      courtType: 'panoramic',
      scenario: 'social',
      status: 'open',
      description: '',
      ratingMin: 1,
      ratingMax: 5,
      isRatingMatch: false,
      pricePerPersonSnapshot: 750,
      occupiedSlots: 1,
      version: 1,
      courtBookingStatus: 'unbooked',
      courtBookingStale: false,
      owner: { playerId: ACCOUNT, firstName: 'Synthetic', lastName: 'Player', rating: 3, isVerified: true },
      participants: [],
    };
    const booking = {
      reservationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      status: 'confirmed',
      serviceId: 30539748,
      courtId: 5730531,
      startsAt: new Date(Date.now() + 43_200_000).toISOString(),
      endsAt: new Date(Date.now() + 48_600_000).toISOString(),
      stale: false,
    };
    let status = 200;
    let body;
    if (path === '/api/v1/auth/telegram/login') body = { credential: CREDENTIAL, expiresAt, accountKind: 'existing' };
    else if (path === '/api/v1/auth/session/me') body = { accountId: ACCOUNT, role: 'player', expiresAt };
    else if (path === '/api/v1/profile/me') body = { accountId: ACCOUNT, role: 'player', firstName: 'Synthetic', lastName: 'Player', username: null, photoUrl: null, languageCode: 'ru', phone: null, sidePreference: null };
    else if (path === '/api/v1/onboarding/me') body = { status: 'completed', legalPolicyCurrent: true, initialLevelLabel: 'D+', initialLevelAlgorithmVersion: 'initial_level_v2' };
    else if (path === '/api/v1/onboarding/me/initial-level-reassessment') body = { status: 'not_eligible' };
    else if (path === '/api/v1/bookings') body = { reservations: [booking] };
    else if (path === '/api/v1/matches/mine') body = { matches: [match] };
    else { status = 503; body = { statusCode: 503, code: 'fixture_unavailable', message: 'Unavailable' }; }
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(body),
    });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Брони 1', exact: true })).toBeVisible();
  await expect(page.getByText('Вход через Telegram подтверждён: аккаунт найден.', { exact: true })).toHaveCount(0);
}

async function createLargePreview(page, matchMarkup, bookingMarkup) {
  await page.evaluate(({ matchMarkup: match, bookingMarkup: booking }) => {
    const board = document.createElement('div');
    board.id = 'padel-icon-preview-board';
    board.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;gap:32px;background:#050F0B;color:#D8F34A;font:700 22px sans-serif';
    board.innerHTML = `
      <div data-preview="matches" style="display:flex;flex-direction:column;align-items:center;gap:18px;padding:28px;border:1px solid rgba(216,243,74,.28);border-radius:24px;background:#071F16">${match}<span>Матчи</span></div>
      <div data-preview="bookings" style="display:flex;flex-direction:column;align-items:center;gap:18px;padding:28px;border:1px solid rgba(216,243,74,.28);border-radius:24px;background:#071F16">${booking}<span>Бронь</span></div>
      <div data-preview="racket-axis" style="display:flex;flex-direction:column;align-items:center;gap:18px;padding:28px;border:1px solid rgba(255,111,97,.45);border-radius:24px;background:#071F16">${match}<span>Ось ракетки · review</span></div>`;
    document.body.appendChild(board);
    for (const svg of board.querySelectorAll('svg')) {
      svg.setAttribute('width', '192');
      svg.setAttribute('height', '192');
    }
    const axisSvg = board.querySelector('[data-preview="racket-axis"] svg');
    axisSvg.querySelector('[data-padel-part="ball"]').remove();
    const axisRackets = axisSvg.querySelectorAll('[data-padel-part="racket"]');
    axisRackets[1].remove();
    const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    axis.setAttribute('x1', '0');
    axis.setAttribute('y1', '-5.8');
    axis.setAttribute('x2', '0');
    axis.setAttribute('y2', '14.6');
    axis.setAttribute('stroke', '#FF6F61');
    axis.setAttribute('stroke-width', '.22');
    axis.setAttribute('stroke-dasharray', '.65 .45');
    axis.setAttribute('data-review-axis', 'true');
    axisRackets[0].appendChild(axis);
  }, { matchMarkup, bookingMarkup });
}

for (const viewport of [{ width: 375, height: 667 }, { width: 667, height: 375 }]) {
  test(`booking and match icons remain clear at app sizes ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    const prefix = viewport.width === 375 ? 'portrait' : 'landscape';
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await prepare(page);

    const heading = page.getByRole('heading', { name: 'Мои события' });
    await expect(heading.locator('xpath=../..').locator('svg')).toHaveCount(0);

    const matchTab = page.getByRole('button', { name: 'Матчи', exact: true });
    const bookingTab = page.getByRole('button', { name: 'Бронь', exact: true });
    const matchNavIcon = matchTab.locator('svg');
    const bookingNavIcon = bookingTab.locator('svg');
    await matchTab.click();
    await expectMatchComposition(matchNavIcon);
    const matchMarkup = await matchNavIcon.evaluate((svg) => svg.outerHTML);
    await page.locator('.bottom-nav').screenshot({ path: testInfo.outputPath(`${prefix}-bottom-nav-matches-active.png`) });
    await bookingTab.click();
    await expectBookingPalette(bookingNavIcon);
    const bookingMarkup = await bookingNavIcon.evaluate((svg) => svg.outerHTML);
    await page.locator('.bottom-nav').screenshot({ path: testInfo.outputPath(`${prefix}-bottom-nav-booking-active.png`) });

    await page.getByRole('button', { name: 'Главная', exact: true }).click();
    const bookingFilter = page.getByRole('button', { name: 'Брони 1', exact: true });
    const matchFilter = page.getByRole('button', { name: 'Матчи 1', exact: true });
    await expect(bookingFilter.locator('svg')).toHaveAttribute('width', '14');
    await expect(matchFilter.locator('svg')).toHaveAttribute('width', '14');
    await expectBookingPalette(bookingFilter.locator('svg'));
    await expectMatchComposition(matchFilter.locator('svg'));
    await page.locator('section').filter({ has: heading }).screenshot({ path: testInfo.outputPath(`${prefix}-home-icons.png`) });

    await bookingFilter.click();
    const bookingBadge = page.locator('.home-event-kind-badge').filter({ has: page.locator('[data-padel-icon="bookings"]') });
    await expect(bookingBadge.locator('svg')).toHaveAttribute('width', '11');
    await expectBookingPalette(bookingBadge.locator('svg'));
    await bookingFilter.screenshot({ path: testInfo.outputPath(`${prefix}-booking-filter-14.png`) });
    await bookingBadge.screenshot({ path: testInfo.outputPath(`${prefix}-booking-badge-11.png`) });

    await matchFilter.click();
    const matchBadge = page.locator('.home-event-kind-badge').filter({ has: page.locator('[data-padel-icon="matches"]') });
    await expect(matchBadge.locator('svg')).toHaveAttribute('width', '11');
    await expectMatchComposition(matchBadge.locator('svg'));
    await matchFilter.screenshot({ path: testInfo.outputPath(`${prefix}-match-filter-14.png`) });
    await matchBadge.screenshot({ path: testInfo.outputPath(`${prefix}-match-badge-11.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await createLargePreview(page, matchMarkup, bookingMarkup);
    await page.locator('[data-preview="matches"]').screenshot({ path: testInfo.outputPath(`${prefix}-matches-large.png`) });
    await page.locator('[data-preview="bookings"]').screenshot({ path: testInfo.outputPath(`${prefix}-booking-large.png`) });
    await page.locator('[data-preview="racket-axis"]').screenshot({ path: testInfo.outputPath(`${prefix}-racket-axis-review.png`) });
  });
}

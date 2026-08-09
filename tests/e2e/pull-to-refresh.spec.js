const { test, expect } = require('@playwright/test');

const TELEGRAM_SDK_ROUTE = 'https://telegram.org/js/telegram-web-app.js';

async function mountHarness(page, { pending = false } = {}) {
  await page.evaluate(async ({ keepPending }) => {
    const applicationRoot = document.getElementById('root');
    if (applicationRoot) {
      applicationRoot.style.display = 'none';
      applicationRoot.setAttribute('aria-hidden', 'true');
    }

    const reactModule = await import('/@id/react');
    const React = reactModule.default ?? reactModule;
    const reactDomClientModule = await import('/@id/react-dom/client');
    const { createRoot } = reactDomClientModule.default ?? reactDomClientModule;
    const { default: PullToRefresh } = await import(
      '/src/components/PullToRefresh.jsx'
    );

    const container = document.createElement('div');
    container.id = 'pull-refresh-harness';
    document.body.append(container);
    window.__pullRefreshCalls = 0;
    window.__resolvePullRefresh = null;

    const onRefresh = () => {
      window.__pullRefreshCalls += 1;
      if (!keepPending) return Promise.resolve();
      return new Promise((resolve) => {
        window.__resolvePullRefresh = resolve;
      });
    };

    createRoot(container).render(React.createElement(
      PullToRefresh,
      { onRefresh, testId: 'pull-refresh-harness-gesture' },
      React.createElement('div', {
        style: { minHeight: '1800px', paddingTop: '24px' },
      }, 'Содержимое раздела'),
    ));
  }, { keepPending: pending });
  await expect(page.getByTestId('pull-refresh-harness-gesture')).toBeVisible();
}

async function dispatchTouchGesture(page, points) {
  await page.evaluate(({ start, move }) => {
    const target = document.querySelector(
      '[data-testid="pull-refresh-harness-gesture"]',
    );
    const dispatch = (type, touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', {
        configurable: true,
        value: touches,
      });
      target.dispatchEvent(event);
    };
    dispatch('touchstart', [{ clientX: start.x, clientY: start.y }]);
    dispatch('touchmove', [{ clientX: move.x, clientY: move.y }]);
    dispatch('touchend', []);
  }, points);
}

test.beforeEach(async ({ page }) => {
  await page.route(TELEGRAM_SDK_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '',
    });
  });
  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, 0));
});

test('refreshes once after a vertical pull from the page top', async ({ page }) => {
  await mountHarness(page, { pending: true });
  await dispatchTouchGesture(page, {
    start: { x: 120, y: 12 },
    move: { x: 120, y: 152 },
  });

  const gesture = page.getByTestId('pull-refresh-harness-gesture');
  await expect(gesture).toHaveAttribute('data-refreshing', 'true');
  await expect.poll(() => page.evaluate(() => window.__pullRefreshCalls)).toBe(1);
  await expect(page.getByText('Обновляем…')).toBeVisible();

  await dispatchTouchGesture(page, {
    start: { x: 120, y: 12 },
    move: { x: 120, y: 172 },
  });
  expect(await page.evaluate(() => window.__pullRefreshCalls)).toBe(1);

  await page.evaluate(() => window.__resolvePullRefresh?.());
  await expect(gesture).toHaveAttribute('data-refreshing', 'false');
  expect(await page.evaluate(() => window.__pullRefreshCalls)).toBe(1);
});

test('does not refresh below the threshold or during a horizontal swipe', async ({ page }) => {
  await mountHarness(page);
  await dispatchTouchGesture(page, {
    start: { x: 120, y: 12 },
    move: { x: 120, y: 72 },
  });
  await dispatchTouchGesture(page, {
    start: { x: 20, y: 12 },
    move: { x: 190, y: 62 },
  });

  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.__pullRefreshCalls)).toBe(0);
});

test('does not refresh while the current section is scrolled down', async ({ page }) => {
  await mountHarness(page);
  await page.evaluate(() => window.scrollTo(0, 240));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await dispatchTouchGesture(page, {
    start: { x: 120, y: 12 },
    move: { x: 120, y: 172 },
  });

  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.__pullRefreshCalls)).toBe(0);
});

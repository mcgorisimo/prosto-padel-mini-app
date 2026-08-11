const { test, expect } = require('@playwright/test');

const TELEGRAM_SDK_ROUTE = 'https://telegram.org/js/telegram-web-app.js';
const SENSITIVE_ERROR =
  'Bearer secret-credential initData=user-phone provider-response';
const SANITIZED_BROWSER_ERROR_MESSAGE =
  '[prosto-padel] client error details suppressed';

test.use({
  trace: 'off',
  video: 'off',
  screenshot: 'off',
});

test.beforeEach(async ({ page }) => {
  await page.route(TELEGRAM_SDK_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '',
    });
  });
  await page.addInitScript(() => {
    window.sessionStorage.setItem('prosto-padel-splash-shown', 'true');
  });
});

test('keeps the ordinary root on the existing Telegram auth gate', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('telegram-backend-login-status')).toHaveAttribute(
    'data-status',
    'outside_telegram',
  );
  await expect(page.getByTestId('root-error-boundary')).toHaveCount(0);
  expect(await page.evaluate(() => window.onerror === null)).toBe(true);
});

test('confines raw browser diagnostics before later listeners', async ({
  page,
}) => {
  const consoleMessages = [];
  const pageErrors = [];
  page.on('console', (message) => {
    consoleMessages.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  await page.goto('/');

  const result = await page.evaluate(async (sensitiveError) => {
    const observed = [];
    window.addEventListener('error', (event) => {
      observed.push(event.message);
    }, true);
    window.addEventListener('unhandledrejection', (event) => {
      observed.push(String(event.reason));
    }, true);

    console.error(new Error(sensitiveError));
    const errorEvent = new ErrorEvent('error', {
      cancelable: true,
      error: new Error(sensitiveError),
      message: sensitiveError,
    });
    window.dispatchEvent(errorEvent);
    const rejectionEvent = new Event('unhandledrejection', {
      cancelable: true,
    });
    Object.defineProperty(rejectionEvent, 'reason', {
      value: new Error(sensitiveError),
    });
    window.dispatchEvent(rejectionEvent);

    const resourceErrorHandled = await new Promise((resolve) => {
      const image = document.createElement('img');
      image.addEventListener('error', () => {
        image.remove();
        resolve(true);
      });
      image.src = `/missing-resource-${Date.now()}.png`;
      document.body.appendChild(image);
    });

    return {
      errorDefaultPrevented: errorEvent.defaultPrevented,
      observed,
      rejectionDefaultPrevented: rejectionEvent.defaultPrevented,
      resourceErrorHandled,
    };
  }, SENSITIVE_ERROR);

  expect(result).toEqual({
    errorDefaultPrevented: true,
    observed: [],
    rejectionDefaultPrevented: true,
    resourceErrorHandled: true,
  });
  expect(consoleMessages.length).toBeGreaterThanOrEqual(3);
  expect(consoleMessages.filter((message) =>
    message === SANITIZED_BROWSER_ERROR_MESSAGE).length).toBeGreaterThanOrEqual(3);
  expect(consoleMessages.join('\n')).not.toContain(SENSITIVE_ERROR);
  expect(pageErrors.join('\n')).not.toContain(SENSITIVE_ERROR);
});

test('recovers from a render failure without exposing raw diagnostics', async ({
  page,
}) => {
  const consoleMessages = [];
  const pageErrors = [];
  page.on('console', (message) => {
    consoleMessages.push(message.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  await page.route('**/src/components/AuthGate.jsx*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        import React from '/@id/react';
        let shouldThrow = true;
        export function recoverSyntheticAuthGate() {
          shouldThrow = false;
        }
        export default function AuthGate() {
          if (shouldThrow) throw new Error(${JSON.stringify(SENSITIVE_ERROR)});
          return React.createElement(
            'p',
            { 'data-testid': 'root-error-recovered-content' },
            'Экран восстановлен',
          );
        }
      `,
    });
  });
  await page.goto('/');

  const fallback = page.getByTestId('root-error-boundary');
  const retry = page.getByRole('button', { name: 'Попробовать снова' });
  await expect(fallback).toBeVisible();
  await expect(page.getByRole('heading', {
    name: 'Не удалось открыть приложение',
  })).toBeVisible();
  await expect(retry).toBeFocused();
  await expect(page.locator('body')).not.toContainText(SENSITIVE_ERROR);
  expect(consoleMessages.join('\n')).not.toContain(SENSITIVE_ERROR);
  expect(consoleMessages).toContain(SANITIZED_BROWSER_ERROR_MESSAGE);
  expect(pageErrors.join('\n')).not.toContain(SENSITIVE_ERROR);

  await page.evaluate(async () => {
    const authGate = await import('/src/components/AuthGate.jsx');
    authGate.recoverSyntheticAuthGate();
  });
  await retry.click();

  await expect(page.getByTestId('root-error-recovered-content')).toHaveText(
    'Экран восстановлен',
  );
  await expect(fallback).toHaveCount(0);
});

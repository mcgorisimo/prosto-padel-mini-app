const { test, expect } = require('@playwright/test');

const FEATURE_ENABLED =
  process.env.VITE_TELEGRAM_BACKEND_LOGIN_ENABLED === 'true';
const LOGIN_ROUTE = '**/api/v1/auth/telegram/login';
const SYNTHETIC_INIT_DATA =
  'query_id=synthetic-login&auth_date=1700000000&hash=synthetic-hash';
const SYNTHETIC_CREDENTIAL =
  'synthetic-credential-for-browser-regression-only';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

test.use({
  trace: 'off',
  video: 'off',
  screenshot: 'off',
});

function successBody(accountKind = 'new') {
  return {
    credential: SYNTHETIC_CREDENTIAL,
    expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    accountKind,
  };
}

function createSensitiveTextDetector(sensitiveValues) {
  let detected = false;

  return Object.freeze({
    inspect(text) {
      if (sensitiveValues.some((value) => text.includes(value))) {
        detected = true;
      }
    },
    detected() {
      return detected;
    },
  });
}

async function prepareBrowser(page, {
  includeTelegram = true,
  initData = SYNTHETIC_INIT_DATA,
} = {}) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('prosto-padel-splash-shown', 'true');

    const originalOpen = window.indexedDB.open.bind(window.indexedDB);
    window.__syntheticIndexedDbOpenCount = 0;
    window.indexedDB.open = (...args) => {
      window.__syntheticIndexedDbOpenCount += 1;
      return originalOpen(...args);
    };
  });

  if (!includeTelegram) return;

  await page.addInitScript((rawInitData) => {
    window.Telegram = {
      WebApp: {
        initData: rawInitData,
        initDataUnsafe: {
          user: {
            id: 123456789,
            first_name: 'Synthetic',
            last_name: 'Player',
          },
        },
        ready() {},
        expand() {},
        disableVerticalSwipes() {},
        HapticFeedback: {
          impactOccurred() {},
        },
      },
    };
  }, initData);
}

async function fulfillJson(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function establishSyntheticSupabaseSession(page) {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'telegram-lifecycle@prostopadel.test',
    app_metadata: {
      provider: 'email',
      providers: ['email'],
    },
    user_metadata: {},
    identities: [],
    created_at: '2026-01-01T00:00:00.000Z',
  };

  await page.route('**/auth/v1/user', async (route) => {
    await fulfillJson(route, 200, user);
  });

  return page.evaluate(async (syntheticUser) => {
    const encode = (value) => btoa(JSON.stringify(value))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    const expiresAt = Math.floor(Date.now() / 1_000) + 3_600;
    const accessToken = [
      encode({ alg: 'HS256', typ: 'JWT' }),
      encode({
        aud: syntheticUser.aud,
        exp: expiresAt,
        sub: syntheticUser.id,
        email: syntheticUser.email,
        role: syntheticUser.role,
      }),
      'synthetic-signature',
    ].join('.');
    const { supabase } = await import('/src/lib/supabaseClient.js');
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: 'synthetic-refresh-token',
    });

    return {
      hasSession: data.session !== null,
      hasError: error !== null,
    };
  }, user);
}

async function expectExistingSupabaseWelcome(page) {
  await expect(page.locator('button')).toHaveCount(2);
}

test.describe('Telegram backend login feature disabled', () => {
  test.skip(
    FEATURE_ENABLED,
    'This regression requires the default-off Vite build.',
  );

  test('keeps the existing Supabase UX and makes no backend request', async ({
    page,
  }) => {
    let calls = 0;
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      calls += 1;
      await fulfillJson(route, 200, successBody());
    });

    await page.goto('/');
    await expectExistingSupabaseWelcome(page);
    await page.waitForTimeout(300);

    expect(calls).toBe(0);
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveCount(0);
  });
});

test.describe('Telegram backend login feature enabled', () => {
  test.skip(
    !FEATURE_ENABLED,
    'This regression requires VITE_TELEGRAM_BACKEND_LOGIN_ENABLED=true.',
  );

  test('sends the exact request once, accepts new account and leaks no credential', async ({
    page,
  }) => {
    const consoleLeakDetector = createSensitiveTextDetector([
      SYNTHETIC_CREDENTIAL,
      SYNTHETIC_INIT_DATA,
    ]);
    let requestCount = 0;
    let requestKey = '';
    let requestKeyConsoleLeakDetected = false;
    let requestContract = null;

    page.on('console', (message) => {
      const text = message.text();
      consoleLeakDetector.inspect(text);
      if (requestKey && text.includes(requestKey)) {
        requestKeyConsoleLeakDetected = true;
      }
    });

    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      requestCount += 1;
      const body = route.request().postDataJSON();
      const headers = route.request().headers();
      requestKey = body.requestKey;
      requestContract = {
        exactKeys:
          Object.keys(body).sort().join(',') === 'initData,requestKey',
        initDataMatches: body.initData === SYNTHETIC_INIT_DATA,
        requestKeyIsUuid: UUID_PATTERN.test(requestKey),
        hasNow: Object.prototype.hasOwnProperty.call(body, 'now'),
        hasAuthorization: Object.prototype.hasOwnProperty.call(
          headers,
          'authorization',
        ),
        hasCookie: Object.prototype.hasOwnProperty.call(headers, 'cookie'),
      };
      await fulfillJson(route, 200, successBody('new'));
    });

    await page.goto('/');

    const status = page.getByTestId('telegram-backend-login-status');
    await expect(status).toHaveAttribute('data-status', 'authenticated');
    await expect(status).toContainText('новый аккаунт создан');
    await expectExistingSupabaseWelcome(page);

    expect(requestCount).toBe(1);
    expect(requestContract).toEqual({
      exactKeys: true,
      initDataMatches: true,
      requestKeyIsUuid: true,
      hasNow: false,
      hasAuthorization: false,
      hasCookie: false,
    });

    const exposure = await page.evaluate(async ({
      credential,
      initData,
      requestKey: browserRequestKey,
    }) => {
      const localValues = Object.values(window.localStorage);
      const sessionValues = Object.values(window.sessionStorage);
      const databaseList = typeof window.indexedDB.databases === 'function'
        ? await window.indexedDB.databases()
        : [];
      const renderedText = document.documentElement.textContent;

      return {
        dom:
          renderedText.includes(credential) ||
          renderedText.includes(initData) ||
          renderedText.includes(browserRequestKey),
        url: window.location.href.includes(credential),
        localStorage: localValues.some((value) => value.includes(credential)),
        sessionStorage: sessionValues.some((value) =>
          value.includes(credential)),
        indexedDbOpened: window.__syntheticIndexedDbOpenCount,
        indexedDbMetadata: JSON.stringify(databaseList).includes(credential),
      };
    }, {
      credential: SYNTHETIC_CREDENTIAL,
      initData: SYNTHETIC_INIT_DATA,
      requestKey,
    });

    expect(exposure).toEqual({
      dom: false,
      url: false,
      localStorage: false,
      sessionStorage: false,
      indexedDbOpened: 0,
      indexedDbMetadata: false,
    });
    expect(consoleLeakDetector.detected()).toBe(false);
    expect(requestKeyConsoleLeakDetected).toBe(false);
  });

  test('uses boolean-only console leakage assertions', () => {
    const detector = createSensitiveTextDetector([
      SYNTHETIC_CREDENTIAL,
      SYNTHETIC_INIT_DATA,
    ]);
    detector.inspect(`synthetic console payload: ${SYNTHETIC_CREDENTIAL}`);
    expect(detector.detected()).toBe(true);
  });

  test('accepts the existing account result', async ({ page }) => {
    let calls = 0;
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      calls += 1;
      await fulfillJson(route, 200, successBody('existing'));
    });

    await page.goto('/');

    const status = page.getByTestId('telegram-backend-login-status');
    await expect(status).toHaveAttribute('data-status', 'authenticated');
    await expect(status).toContainText('аккаунт найден');
    expect(calls).toBe(1);
  });

  test('shows a success status briefly and removes its accessible element within three seconds', async ({
    page,
  }) => {
    await page.clock.install();
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      await fulfillJson(route, 200, successBody('new'));
    });

    await page.goto('/');

    const status = page.getByTestId('telegram-backend-login-status');
    await expect(status).toHaveAttribute('data-status', 'authenticated');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await page.clock.fastForward(3_000);
    await expect(status).toHaveCount(0);
  });

  for (const action of [
    { name: 'Создать профиль' },
    { name: 'У меня есть аккаунт' },
  ]) {
    test(`hides a success status when the user selects "${action.name}"`, async ({
      page,
    }) => {
      await prepareBrowser(page);
      await page.route(LOGIN_ROUTE, async (route) => {
        await fulfillJson(route, 200, successBody('new'));
      });

      await page.goto('/');
      const status = page.getByTestId('telegram-backend-login-status');
      await expect(status).toHaveAttribute('data-status', 'authenticated');

      await page.getByRole('button', { name: action.name, exact: true }).click();

      await expect(status).toHaveCount(0);
    });
  }

  test('hides a success status when the primary Supabase session appears', async ({
    page,
  }) => {
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      await fulfillJson(route, 200, successBody('existing'));
    });

    await page.goto('/');
    const status = page.getByTestId('telegram-backend-login-status');
    await expect(status).toHaveAttribute('data-status', 'authenticated');

    const sessionResult = await establishSyntheticSupabaseSession(page);

    expect(sessionResult).toEqual({
      hasSession: true,
      hasError: false,
    });
    await expect(status).toHaveCount(0);
  });

  test('keeps a Telegram login error visible beyond the success timeout', async ({
    page,
  }) => {
    await page.clock.install();
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      await fulfillJson(route, 401, {
        statusCode: 401,
        code: 'telegram_authentication_failed',
        message: 'Synthetic public error',
      });
    });

    await page.goto('/');
    const status = page.getByTestId('telegram-backend-login-status');
    await expect(status).toHaveAttribute(
      'data-status',
      'invalid_telegram_data',
    );
    await page.clock.fastForward(3_100);
    await expect(status).toHaveAttribute(
      'data-status',
      'invalid_telegram_data',
    );
  });

  test('cleans success timers and does not replay a dismissed success on remount', async ({
    page,
  }) => {
    await prepareBrowser(page, { initData: '' });
    await page.goto('/');

    const summary = await page.evaluate(async () => {
      const { createTelegramBackendLoginLifecycle } = await import(
        '/src/hooks/useTelegramBackendLogin.js'
      );
      const waitFor = async (predicate) => {
        for (let index = 0; index < 100; index += 1) {
          if (predicate()) return true;
          await Promise.resolve();
        }
        return false;
      };
      const createTimers = () => {
        let nextId = 1;
        const active = new Map();
        const cleared = new Set();
        return {
          active,
          cleared,
          setTimer(callback, delay) {
            const id = nextId;
            nextId += 1;
            active.set(id, { callback, delay });
            return id;
          },
          clearTimer(id) {
            active.delete(id);
            cleared.add(id);
          },
          run(id) {
            const timer = active.get(id);
            active.delete(id);
            timer?.callback();
          },
          idForDelay(delay) {
            return [...active.entries()]
              .find(([, timer]) => timer.delay === delay)?.[0] ?? null;
          },
        };
      };
      const authenticated = {
        outcome: 'authenticated',
        credential: 'synthetic-private-success-lifecycle-credential',
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
        accountKind: 'new',
      };

      const replacementTimers = createTimers();
      let replacementCalls = 0;
      const replacementStatuses = [];
      const replacementLifecycle = createTelegramBackendLoginLifecycle({
        fingerprint: async () => 'synthetic-success-fingerprint',
        setTimer: replacementTimers.setTimer,
        clearTimer: replacementTimers.clearTimer,
        client: {
          async login() {
            replacementCalls += 1;
            return authenticated;
          },
        },
      });
      const detachFirst = replacementLifecycle.attach(
        'synthetic-success-init-data',
        (snapshot) => replacementStatuses.push(snapshot.status),
      );
      await waitFor(() =>
        replacementStatuses.at(-1) === 'authenticated');
      const replacementSuccessTimer =
        replacementTimers.idForDelay(3_000);
      replacementLifecycle.dismissSuccess();
      const dismissedCredentialRetained =
        replacementLifecycle.hasCredential();
      detachFirst();

      const remountStatuses = [];
      const detachRemount = replacementLifecycle.attach(
        'synthetic-success-init-data',
        (snapshot) => remountStatuses.push(snapshot.status),
      );
      await Promise.resolve();
      await Promise.resolve();
      const dismissedSuccessNotReplayed =
        replacementCalls === 1 &&
        !remountStatuses.includes('authenticated');
      detachRemount();
      const replacementTeardownTimer =
        replacementTimers.idForDelay(0);
      replacementTimers.run(replacementTeardownTimer);

      const unmountTimers = createTimers();
      const unmountStatuses = [];
      const unmountLifecycle = createTelegramBackendLoginLifecycle({
        fingerprint: async () => 'synthetic-unmount-success-fingerprint',
        setTimer: unmountTimers.setTimer,
        clearTimer: unmountTimers.clearTimer,
        client: {
          async login() {
            return authenticated;
          },
        },
      });
      const detachUnmount = unmountLifecycle.attach(
        'synthetic-unmount-success-init-data',
        (snapshot) => unmountStatuses.push(snapshot.status),
      );
      await waitFor(() => unmountStatuses.at(-1) === 'authenticated');
      const unmountSuccessTimer = unmountTimers.idForDelay(3_000);
      detachUnmount();
      const unmountTeardownTimer = unmountTimers.idForDelay(0);
      unmountTimers.run(unmountTeardownTimer);

      return {
        successDelayIsExact:
          replacementSuccessTimer !== null,
        replacementTimerCleared:
          replacementTimers.cleared.has(replacementSuccessTimer),
        dismissedCredentialRetained,
        dismissedSuccessNotReplayed,
        replacementClearedAfterFinalUnmount:
          !replacementLifecycle.hasCredential(),
        unmountTimerCleared:
          unmountTimers.cleared.has(unmountSuccessTimer),
        unmountCredentialCleared:
          !unmountLifecycle.hasCredential(),
      };
    });

    expect(summary).toEqual({
      successDelayIsExact: true,
      replacementTimerCleared: true,
      dismissedCredentialRetained: true,
      dismissedSuccessNotReplayed: true,
      replacementClearedAfterFinalUnmount: true,
      unmountTimerCleared: true,
      unmountCredentialCleared: true,
    });
  });

  test('retries an exact public 503 twice with one request key', async ({
    page,
  }) => {
    let calls = 0;
    let firstRequestKey = null;
    let requestKeysMatch = true;
    let requestKeyIsUuid = false;

    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      const body = route.request().postDataJSON();
      calls += 1;
      if (firstRequestKey === null) {
        firstRequestKey = body.requestKey;
        requestKeyIsUuid = UUID_PATTERN.test(firstRequestKey);
      } else {
        requestKeysMatch =
          requestKeysMatch && body.requestKey === firstRequestKey;
      }

      if (calls < 3) {
        await fulfillJson(route, 503, {
          statusCode: 503,
          code: 'telegram_authentication_unavailable',
          message: 'Telegram authentication is unavailable',
        });
        return;
      }

      await fulfillJson(route, 200, successBody('existing'));
    });

    await page.goto('/');
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveAttribute('data-status', 'authenticated');

    expect({ calls, requestKeysMatch, requestKeyIsUuid }).toEqual({
      calls: 3,
      requestKeysMatch: true,
      requestKeyIsUuid: true,
    });
  });

  test('stops after the third exact public 503', async ({ page }) => {
    let calls = 0;
    let firstRequestKey = null;
    let requestKeysMatch = true;

    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      const requestKey = route.request().postDataJSON().requestKey;
      calls += 1;
      if (firstRequestKey === null) {
        firstRequestKey = requestKey;
      } else {
        requestKeysMatch = requestKeysMatch && requestKey === firstRequestKey;
      }
      await fulfillJson(route, 503, {
        statusCode: 503,
        code: 'telegram_authentication_unavailable',
        message: 'Telegram authentication is unavailable',
      });
    });

    await page.goto('/');
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveAttribute('data-status', 'temporary_unavailable');

    expect({ calls, requestKeysMatch }).toEqual({
      calls: 3,
      requestKeysMatch: true,
    });
  });

  test('retries network failures with one request key and at most three calls', async ({
    page,
  }) => {
    let calls = 0;
    let firstRequestKey = null;
    let requestKeysMatch = true;

    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      const requestKey = route.request().postDataJSON().requestKey;
      calls += 1;
      if (firstRequestKey === null) {
        firstRequestKey = requestKey;
      } else {
        requestKeysMatch = requestKeysMatch && requestKey === firstRequestKey;
      }

      if (calls < 3) {
        await route.abort('failed');
        return;
      }
      await fulfillJson(route, 200, successBody('existing'));
    });

    await page.goto('/');
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveAttribute('data-status', 'authenticated');

    expect({ calls, requestKeysMatch }).toEqual({
      calls: 3,
      requestKeysMatch: true,
    });
  });

  test('reuses the request key after a per-request timeout', async ({
    page,
  }) => {
    await prepareBrowser(page, { initData: '' });
    await page.goto('/');

    const summary = await page.evaluate(async () => {
      const { createTelegramBackendLoginClient } = await import(
        '/src/lib/telegramBackendLogin.js'
      );
      const requestKeys = [];
      const requestOptions = [];
      const fixedRequestKey = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      let calls = 0;

      const client = createTelegramBackendLoginClient({
        cryptoImpl: {
          randomUUID: () => fixedRequestKey,
        },
        requestTimeoutMs: 5,
        random: () => 0,
        sleep: async () => {},
        fetchImpl: async (_url, options) => {
          calls += 1;
          requestKeys.push(JSON.parse(options.body).requestKey);
          requestOptions.push({
            method: options.method,
            cache: options.cache,
            credentials: options.credentials,
            redirect: options.redirect,
          });

          if (calls === 1) {
            return new Response(new ReadableStream({
              start() {
                // Headers arrive, but the response body never completes.
              },
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          return new Response(JSON.stringify({
            credential: 'synthetic-timeout-credential',
            expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
            accountKind: 'existing',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const result = await client.login('synthetic-timeout-init-data');
      return {
        calls,
        requestKeysMatch:
          requestKeys.length === 2 &&
          requestKeys.every((value) => value === fixedRequestKey),
        requestOptions,
        outcome: result.outcome,
        accountKind: result.accountKind,
      };
    });

    expect(summary).toEqual({
      calls: 2,
      requestKeysMatch: true,
      requestOptions: [
        {
          method: 'POST',
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
        },
        {
          method: 'POST',
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
        },
      ],
      outcome: 'authenticated',
      accountKind: 'existing',
    });
  });

  test('fails closed before fetch when randomUUID is unavailable', async ({
    page,
  }) => {
    await prepareBrowser(page, { initData: '' });
    await page.goto('/');

    const summary = await page.evaluate(async () => {
      const { createTelegramBackendLoginClient } = await import(
        '/src/lib/telegramBackendLogin.js'
      );
      let calls = 0;
      const client = createTelegramBackendLoginClient({
        cryptoImpl: {},
        fetchImpl: async () => {
          calls += 1;
          throw new Error('must not run');
        },
      });
      const result = await client.login('synthetic-init-data');
      return {
        calls,
        outcome: result.outcome,
        errorKind: result.errorKind,
      };
    });

    expect(summary).toEqual({
      calls: 0,
      outcome: 'failed',
      errorKind: 'internal_error',
    });
  });

  for (const scenario of [
    {
      name: 'does not retry 400',
      status: 400,
      code: 'telegram_login_request_invalid',
      expectedStatus: 'internal_error',
    },
    {
      name: 'does not retry 401',
      status: 401,
      code: 'telegram_authentication_failed',
      expectedStatus: 'invalid_telegram_data',
    },
    {
      name: 'does not retry 403',
      status: 403,
      code: 'telegram_account_unavailable',
      expectedStatus: 'account_unavailable',
    },
    {
      name: 'does not retry proof replay',
      status: 409,
      code: 'telegram_proof_replayed',
      expectedStatus: 'conflict_reopen_required',
    },
    {
      name: 'does not retry request conflict',
      status: 409,
      code: 'telegram_authentication_conflict',
      expectedStatus: 'conflict_reopen_required',
    },
    {
      name: 'does not retry 500',
      status: 500,
      code: 'telegram_authentication_internal_error',
      expectedStatus: 'internal_error',
    },
  ]) {
    test(scenario.name, async ({ page }) => {
      let calls = 0;
      await prepareBrowser(page);
      await page.route(LOGIN_ROUTE, async (route) => {
        calls += 1;
        await fulfillJson(route, scenario.status, {
          statusCode: scenario.status,
          code: scenario.code,
          message: 'Synthetic public error',
        });
      });

      await page.goto('/');
      await expect(
        page.getByTestId('telegram-backend-login-status'),
      ).toHaveAttribute('data-status', scenario.expectedStatus);
      expect(calls).toBe(1);
    });
  }

  test('rejects a success response with additional internal fields', async ({
    page,
  }) => {
    let calls = 0;
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      calls += 1;
      await fulfillJson(route, 200, {
        ...successBody(),
        accountId: 'synthetic-internal-account-id',
      });
    });

    await page.goto('/');
    const status = page.getByTestId('telegram-backend-login-status');
    await expect(status).toHaveAttribute('data-status', 'internal_error');
    await expect(status).not.toContainText('synthetic-internal-account-id');
    expect(calls).toBe(1);
  });

  for (const scenario of [
    { name: 'without Telegram WebApp', includeTelegram: false },
    { name: 'with empty Telegram initData', includeTelegram: true, initData: '' },
  ]) {
    test(`does not call the endpoint ${scenario.name}`, async ({ page }) => {
      let calls = 0;
      await prepareBrowser(page, scenario);
      await page.route(LOGIN_ROUTE, async (route) => {
        calls += 1;
        await fulfillJson(route, 200, successBody());
      });

      await page.goto('/');
      const status = page.getByTestId('telegram-backend-login-status');
      await expect(status).toHaveAttribute('data-status', 'outside_telegram');
      await expectExistingSupabaseWelcome(page);
      expect(calls).toBe(0);
    });
  }

  test('cancels active lifecycle work on clear and final detach', async ({
    page,
  }) => {
    await prepareBrowser(page, { initData: '' });
    await page.goto('/');

    const summary = await page.evaluate(async () => {
      const { createTelegramBackendLoginLifecycle } = await import(
        '/src/hooks/useTelegramBackendLogin.js'
      );
      const waitFor = async (predicate) => {
        for (let index = 0; index < 100; index += 1) {
          if (predicate()) return true;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return false;
      };
      const authenticated = {
        outcome: 'authenticated',
        credential: 'synthetic-private-lifecycle-credential',
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
        accountKind: 'new',
      };

      let clearCalls = 0;
      let clearSignalAborted = false;
      let resolveClearAttempt;
      const clearStatuses = [];
      const clearLifecycle = createTelegramBackendLoginLifecycle({
        fingerprint: async () => 'synthetic-fingerprint-clear',
        client: {
          login(_rawInitData, { signal }) {
            clearCalls += 1;
            signal.addEventListener('abort', () => {
              clearSignalAborted = true;
            }, { once: true });
            return new Promise((resolve) => {
              resolveClearAttempt = resolve;
            });
          },
        },
      });
      const detachClear = clearLifecycle.attach(
        'synthetic-clear-init-data',
        (snapshot) => clearStatuses.push(snapshot.status),
      );
      await waitFor(() => clearCalls === 1);
      clearLifecycle.clear();
      resolveClearAttempt(authenticated);
      await waitFor(() => clearSignalAborted);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const clearLateSuccessIgnored =
        clearStatuses.at(-1) === 'idle' &&
        !clearLifecycle.hasCredential();
      detachClear();

      let unmountCalls = 0;
      let unmountSignalAborted = false;
      let resolveUnmountAttempt;
      const unmountStatuses = [];
      const unmountLifecycle = createTelegramBackendLoginLifecycle({
        fingerprint: async () => 'synthetic-fingerprint-unmount',
        client: {
          login(_rawInitData, { signal }) {
            unmountCalls += 1;
            signal.addEventListener('abort', () => {
              unmountSignalAborted = true;
            }, { once: true });
            return new Promise((resolve) => {
              resolveUnmountAttempt = resolve;
            });
          },
        },
      });
      const detachUnmount = unmountLifecycle.attach(
        'synthetic-unmount-init-data',
        (snapshot) => unmountStatuses.push(snapshot.status),
      );
      await waitFor(() => unmountCalls === 1);
      detachUnmount();
      await waitFor(() => unmountSignalAborted);
      const statusCountAfterDetach = unmountStatuses.length;
      resolveUnmountAttempt(authenticated);
      await new Promise((resolve) => setTimeout(resolve, 0));

      return {
        clearCalls,
        clearSignalAborted,
        clearLateSuccessIgnored,
        unmountCalls,
        unmountSignalAborted,
        unmountLateSuccessIgnored:
          unmountStatuses.length === statusCountAfterDetach &&
          !unmountLifecycle.hasCredential(),
      };
    });

    expect(summary).toEqual({
      clearCalls: 1,
      clearSignalAborted: true,
      clearLateSuccessIgnored: true,
      unmountCalls: 1,
      unmountSignalAborted: true,
      unmountLateSuccessIgnored: true,
    });
  });

  test('cancels retry backoff before another request starts', async ({
    page,
  }) => {
    await prepareBrowser(page, { initData: '' });
    await page.goto('/');

    const summary = await page.evaluate(async () => {
      const { createTelegramBackendLoginClient } = await import(
        '/src/lib/telegramBackendLogin.js'
      );
      const { createTelegramBackendLoginLifecycle } = await import(
        '/src/hooks/useTelegramBackendLogin.js'
      );
      const waitFor = async (predicate) => {
        for (let index = 0; index < 100; index += 1) {
          if (predicate()) return true;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return false;
      };

      let calls = 0;
      let backoffStarted = false;
      let backoffTimerCleared = false;
      const client = createTelegramBackendLoginClient({
        cryptoImpl: {
          randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
        fetchImpl: async () => {
          calls += 1;
          return new Response(JSON.stringify({
            statusCode: 503,
            code: 'telegram_authentication_unavailable',
            message: 'Synthetic public error',
          }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        },
        sleep: (_delayMs, signal) => new Promise((resolve) => {
          backoffStarted = true;
          const timer = setTimeout(() => resolve(true), 5_000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            backoffTimerCleared = true;
            resolve(false);
          }, { once: true });
        }),
      });
      const lifecycle = createTelegramBackendLoginLifecycle({
        client,
        fingerprint: async () => 'synthetic-fingerprint-backoff',
      });
      const detach = lifecycle.attach(
        'synthetic-backoff-init-data',
        () => {},
      );

      await waitFor(() => backoffStarted);
      lifecycle.clear();
      await waitFor(() => backoffTimerCleared);
      await new Promise((resolve) => setTimeout(resolve, 20));
      detach();

      return {
        backoffStarted,
        backoffTimerCleared,
        calls,
        hasCredential: lifecycle.hasCredential(),
      };
    });

    expect(summary).toEqual({
      backoffStarted: true,
      backoffTimerCleared: true,
      calls: 1,
      hasCredential: false,
    });
  });

  test('shares one attempt for the same initData and isolates a completed new identity', async ({
    page,
  }) => {
    await prepareBrowser(page, { initData: '' });
    await page.goto('/');

    const summary = await page.evaluate(async () => {
      const { createTelegramBackendLoginClient } = await import(
        '/src/lib/telegramBackendLogin.js'
      );
      const { createTelegramBackendLoginLifecycle } = await import(
        '/src/hooks/useTelegramBackendLogin.js'
      );
      const waitFor = async (predicate) => {
        for (let index = 0; index < 100; index += 1) {
          if (predicate()) return true;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return false;
      };

      const generatedKeys = [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ];
      const observedKeys = [];
      let calls = 0;
      let resolveSecondResponse;
      const client = createTelegramBackendLoginClient({
        cryptoImpl: {
          randomUUID: () => generatedKeys[calls],
        },
        fetchImpl: async (_url, options) => {
          const body = JSON.parse(options.body);
          observedKeys.push(body.requestKey);
          calls += 1;

          if (calls === 2) {
            return new Promise((resolve) => {
              resolveSecondResponse = () => resolve(new Response(
                JSON.stringify({
                  credential: 'synthetic-second-identity-credential',
                  expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
                  accountKind: 'existing',
                }),
                {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                },
              ));
            });
          }

          return new Response(JSON.stringify({
            credential: 'synthetic-first-identity-credential',
            expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
            accountKind: 'new',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
      const lifecycle = createTelegramBackendLoginLifecycle({ client });
      const firstStatuses = [];
      const sameIdentityStatuses = [];
      const secondIdentityStatuses = [];
      const detachFirst = lifecycle.attach(
        'synthetic-first-identity-init-data',
        (snapshot) => firstStatuses.push(snapshot.status),
      );
      const detachSame = lifecycle.attach(
        'synthetic-first-identity-init-data',
        (snapshot) => sameIdentityStatuses.push(snapshot.status),
      );

      await waitFor(() => lifecycle.hasCredential());
      await new Promise((resolve) => setTimeout(resolve, 0));
      const callsForTwoSameConsumers = calls;
      const firstCredentialPresent = lifecycle.hasCredential();

      const detachSecond = lifecycle.attach(
        'synthetic-second-identity-init-data',
        (snapshot) => secondIdentityStatuses.push(snapshot.status),
      );
      await waitFor(() => calls === 2);
      const previousCredentialCleared = !lifecycle.hasCredential();
      const secondSawPreviousResult = secondIdentityStatuses
        .includes('authenticated');
      resolveSecondResponse();
      await waitFor(() =>
        lifecycle.hasCredential() &&
        secondIdentityStatuses.at(-1) === 'authenticated');

      const identitiesUseDifferentKeys =
        observedKeys.length === 2 &&
        observedKeys[0] !== observedKeys[1];
      const secondCredentialPresent = lifecycle.hasCredential();
      detachFirst();
      detachSame();
      detachSecond();
      await new Promise((resolve) => setTimeout(resolve, 10));

      return {
        callsForTwoSameConsumers,
        firstCredentialPresent,
        identitiesUseDifferentKeys,
        previousCredentialCleared,
        secondCredentialPresent,
        secondSawPreviousResult,
        credentialClearedAfterFinalDetach: !lifecycle.hasCredential(),
        bothSameConsumersObservedSuccess:
          firstStatuses.includes('authenticated') &&
          sameIdentityStatuses.includes('authenticated'),
      };
    });

    expect(summary).toEqual({
      callsForTwoSameConsumers: 1,
      firstCredentialPresent: true,
      identitiesUseDifferentKeys: true,
      previousCredentialCleared: true,
      secondCredentialPresent: true,
      secondSawPreviousResult: false,
      credentialClearedAfterFinalDetach: true,
      bothSameConsumersObservedSuccess: true,
    });
  });

  test('cancels an active identity before starting another identity', async ({
    page,
  }) => {
    await prepareBrowser(page, { initData: '' });
    await page.goto('/');

    const summary = await page.evaluate(async () => {
      const { createTelegramBackendLoginClient } = await import(
        '/src/lib/telegramBackendLogin.js'
      );
      const { createTelegramBackendLoginLifecycle } = await import(
        '/src/hooks/useTelegramBackendLogin.js'
      );
      const waitFor = async (predicate) => {
        for (let index = 0; index < 100; index += 1) {
          if (predicate()) return true;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return false;
      };

      const keys = [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ];
      const observedKeys = [];
      let calls = 0;
      let firstSignalAborted = false;
      const client = createTelegramBackendLoginClient({
        cryptoImpl: {
          randomUUID: () => keys[calls],
        },
        fetchImpl: async (_url, options) => {
          observedKeys.push(JSON.parse(options.body).requestKey);
          calls += 1;

          if (calls === 1) {
            options.signal.addEventListener('abort', () => {
              firstSignalAborted = true;
            }, { once: true });
            return new Promise((_resolve, reject) => {
              options.signal.addEventListener('abort', () => {
                reject(new DOMException('aborted', 'AbortError'));
              }, { once: true });
            });
          }

          return new Response(JSON.stringify({
            credential: 'synthetic-new-active-identity-credential',
            expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
            accountKind: 'existing',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
      const lifecycle = createTelegramBackendLoginLifecycle({ client });
      const secondStatuses = [];
      const detachFirst = lifecycle.attach(
        'synthetic-active-first-init-data',
        () => {},
      );
      await waitFor(() => calls === 1);
      const detachSecond = lifecycle.attach(
        'synthetic-active-second-init-data',
        (snapshot) => secondStatuses.push(snapshot.status),
      );
      await waitFor(() =>
        firstSignalAborted &&
        calls === 2 &&
        lifecycle.hasCredential());

      const result = {
        calls,
        firstSignalAborted,
        distinctRequestKeys:
          observedKeys.length === 2 &&
          observedKeys[0] !== observedKeys[1],
        secondAuthenticated:
          secondStatuses.at(-1) === 'authenticated',
      };
      detachFirst();
      detachSecond();
      return result;
    });

    expect(summary).toEqual({
      calls: 2,
      firstSignalAborted: true,
      distinctRequestKeys: true,
      secondAuthenticated: true,
    });
  });

  test('removes failed and malformed attempts before a new identity', async ({
    page,
  }) => {
    await prepareBrowser(page, { initData: '' });
    await page.goto('/');

    const summary = await page.evaluate(async () => {
      const { createTelegramBackendLoginClient } = await import(
        '/src/lib/telegramBackendLogin.js'
      );
      const { createTelegramBackendLoginLifecycle } = await import(
        '/src/hooks/useTelegramBackendLogin.js'
      );
      const waitFor = async (predicate) => {
        for (let index = 0; index < 100; index += 1) {
          if (predicate()) return true;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return false;
      };

      let calls = 0;
      const client = createTelegramBackendLoginClient({
        cryptoImpl: {
          randomUUID: () =>
            calls === 0
              ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
              : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) {
            return new Response(JSON.stringify({
              credential: 'synthetic-malformed-credential',
              expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
              accountKind: 'new',
              accountId: 'synthetic-internal-id',
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          return new Response(JSON.stringify({
            credential: 'synthetic-valid-next-identity-credential',
            expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
            accountKind: 'existing',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
      const lifecycle = createTelegramBackendLoginLifecycle({ client });
      const firstStatuses = [];
      const secondStatuses = [];
      const detachFirst = lifecycle.attach(
        'synthetic-malformed-identity-init-data',
        (snapshot) => firstStatuses.push(snapshot.status),
      );
      await waitFor(() => firstStatuses.at(-1) === 'internal_error');
      const malformedLeftNoCredential = !lifecycle.hasCredential();
      const detachSecond = lifecycle.attach(
        'synthetic-valid-identity-init-data',
        (snapshot) => secondStatuses.push(snapshot.status),
      );
      await waitFor(() =>
        calls === 2 &&
        secondStatuses.at(-1) === 'authenticated' &&
        lifecycle.hasCredential());

      const result = {
        calls,
        malformedLeftNoCredential,
        newIdentityAuthenticated:
          secondStatuses.at(-1) === 'authenticated',
      };
      detachFirst();
      detachSecond();

      let rejectedCalls = 0;
      const rejectedStatuses = [];
      const recoveredStatuses = [];
      const rejectedLifecycle = createTelegramBackendLoginLifecycle({
        fingerprint: async (value) =>
          value === 'synthetic-rejected-init-data'
            ? 'synthetic-rejected-fingerprint'
            : 'synthetic-recovered-fingerprint',
        client: {
          async login() {
            rejectedCalls += 1;
            if (rejectedCalls === 1) {
              throw new Error('SYNTHETIC_CLIENT_REJECTION');
            }
            return {
              outcome: 'authenticated',
              credential: 'synthetic-recovered-credential',
              expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
              accountKind: 'existing',
            };
          },
        },
      });
      const detachRejected = rejectedLifecycle.attach(
        'synthetic-rejected-init-data',
        (snapshot) => rejectedStatuses.push(snapshot.status),
      );
      await waitFor(() => rejectedStatuses.at(-1) === 'internal_error');
      const detachRecovered = rejectedLifecycle.attach(
        'synthetic-recovered-init-data',
        (snapshot) => recoveredStatuses.push(snapshot.status),
      );
      await waitFor(() =>
        rejectedCalls === 2 &&
        recoveredStatuses.at(-1) === 'authenticated' &&
        rejectedLifecycle.hasCredential());
      detachRejected();
      detachRecovered();

      return {
        ...result,
        rejectedAttemptRemoved:
          rejectedCalls === 2 &&
          recoveredStatuses.at(-1) === 'authenticated',
      };
    });

    expect(summary).toEqual({
      calls: 2,
      malformedLeftNoCredential: true,
      newIdentityAuthenticated: true,
      rejectedAttemptRemoved: true,
    });
  });

  test('SIGNED_OUT aborts an active request and ignores its late success', async ({
    page,
  }) => {
    let calls = 0;
    let releaseResponse;
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      calls += 1;
      await new Promise((resolve) => {
        releaseResponse = resolve;
      });
      try {
        await fulfillJson(route, 200, successBody());
      } catch {
        // The browser is expected to have aborted this intercepted request.
      }
    });

    await page.goto('/');
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveAttribute('data-status', 'checking');
    await expect.poll(() => calls).toBe(1);

    const signOutSucceeded = await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabaseClient.js');
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      return error === null;
    });
    expect(signOutSucceeded).toBe(true);
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveCount(0);

    releaseResponse();
    await page.waitForTimeout(200);
    expect(calls).toBe(1);
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveCount(0);
  });

  test('clears the private boundary on Supabase SIGNED_OUT', async ({
    page,
  }) => {
    let calls = 0;
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      calls += 1;
      await fulfillJson(route, 200, successBody());
    });

    await page.goto('/');
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveAttribute('data-status', 'authenticated');

    const signOutError = await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabaseClient.js');
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      return error?.message ?? null;
    });

    expect(signOutError).toBeNull();
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveCount(0);
    await page.waitForTimeout(100);
    expect(calls).toBe(1);
  });
});

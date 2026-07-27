const { test, expect } = require('@playwright/test');

const FEATURE_ENABLED =
  process.env.VITE_TELEGRAM_BACKEND_LOGIN_ENABLED === 'true';
const LOGIN_ROUTE = '**/api/v1/auth/telegram/login';
const REFRESH_ROUTE = '**/api/v1/auth/session/refresh';
const SESSION_ME_ROUTE = '**/api/v1/auth/session/me';
const SYNTHETIC_INIT_DATA =
  'query_id=session-lifecycle&auth_date=1700000000&hash=synthetic';
const SYNTHETIC_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const CURRENT_CREDENTIAL = Buffer.alloc(32, 0x41).toString('base64url');
const NEXT_CREDENTIAL = Buffer.alloc(32, 0x42).toString('base64url');
const LOGIN_CREDENTIAL = Buffer.alloc(32, 0x43).toString('base64url');
const FIXED_REQUEST_KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test.use({
  trace: 'off',
  video: 'off',
  screenshot: 'off',
});

function futureExpiry() {
  return Math.floor(Date.now() / 1_000) + 3_600;
}

async function fulfillJson(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function prepareTelegramWithSecureStorage(
  page,
  credential,
  initData = SYNTHETIC_INIT_DATA,
) {
  await page.addInitScript((parameters) => {
    window.sessionStorage.setItem('prosto-padel-splash-shown', 'true');
    let storedCredential = parameters.credential;

    window.Telegram = {
      WebApp: {
        initData: parameters.initData,
        initDataUnsafe: {},
        isVersionAtLeast(version) {
          return version === '9.0';
        },
        SecureStorage: {
          getItem(_key, callback) {
            queueMicrotask(() => callback(null, storedCredential, false));
          },
          setItem(_key, value, callback) {
            storedCredential = value;
            queueMicrotask(() => callback(null, true));
          },
          removeItem(_key, callback) {
            storedCredential = null;
            queueMicrotask(() => callback(null, true));
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
  }, {
    credential,
    initData,
  });
}

test.describe('backend session credential lifecycle', () => {
  test.skip(
    !FEATURE_ENABLED,
    'This regression requires VITE_TELEGRAM_BACKEND_LOGIN_ENABLED=true.',
  );

  test.beforeEach(async ({ page }) => {
    await page.route(SESSION_ME_ROUTE, async (route) => {
      await fulfillJson(route, 200, {
        accountId: SYNTHETIC_ACCOUNT_ID,
        role: 'player',
        expiresAt: futureExpiry(),
      });
    });
  });

  test('restores through refresh, replaces SecureStorage and skips Telegram login', async ({
    page,
  }) => {
    let refreshCalls = 0;
    let authenticationCalls = 0;
    let loginCalls = 0;
    let safeRequestContract = null;
    let safeAuthenticationContract = null;
    let consoleLeakDetected = false;

    page.on('console', (message) => {
      const text = message.text();
      if (
        text.includes(CURRENT_CREDENTIAL) ||
        text.includes(NEXT_CREDENTIAL) ||
        text.includes(SYNTHETIC_INIT_DATA)
      ) {
        consoleLeakDetected = true;
      }
    });

    await prepareTelegramWithSecureStorage(page, CURRENT_CREDENTIAL);
    await page.route(REFRESH_ROUTE, async (route) => {
      refreshCalls += 1;
      const request = route.request();
      const body = request.postDataJSON();
      const headers = request.headers();
      safeRequestContract = {
        exactBody:
          Object.keys(body).join(',') === 'requestKey',
        requestKeyIsUuid:
          /^[0-9a-f-]{36}$/iu.test(body.requestKey),
        bearerMatches:
          headers.authorization === `Bearer ${CURRENT_CREDENTIAL}`,
        noCookie:
          !Object.prototype.hasOwnProperty.call(headers, 'cookie'),
      };
      await fulfillJson(route, 200, {
        credential: NEXT_CREDENTIAL,
        expiresAt: futureExpiry(),
      });
    });
    await page.unroute(SESSION_ME_ROUTE);
    await page.route(SESSION_ME_ROUTE, async (route) => {
      authenticationCalls += 1;
      const request = route.request();
      const headers = request.headers();
      safeAuthenticationContract = {
        method: request.method(),
        bearerMatches:
          headers.authorization === `Bearer ${NEXT_CREDENTIAL}`,
        noBody: request.postData() === null,
        noCookie:
          !Object.prototype.hasOwnProperty.call(headers, 'cookie'),
      };
      await fulfillJson(route, 200, {
        accountId: SYNTHETIC_ACCOUNT_ID,
        role: 'player',
        expiresAt: futureExpiry(),
      });
    });
    await page.route(LOGIN_ROUTE, async (route) => {
      loginCalls += 1;
      await fulfillJson(route, 500, {
        code: 'must_not_be_called',
      });
    });

    await page.goto('/');
    const status = page.getByTestId('telegram-backend-login-status');
    await expect(status).toHaveAttribute('data-status', 'session_restored');

    const storageSummary = await page.evaluate(async (values) => {
      const readSecureStorage = () => new Promise((resolve) => {
        window.Telegram.WebApp.SecureStorage.getItem(
          'prosto_padel_backend_session_v1',
          (_error, value) => resolve(value),
        );
      });
      const secureValue = await readSecureStorage();
      const localValues = Object.values(window.localStorage);
      const sessionValues = Object.values(window.sessionStorage);
      const databases = typeof window.indexedDB.databases === 'function'
        ? await window.indexedDB.databases()
        : [];

      return {
        secureCredentialReplaced: secureValue === values.next,
        oldCredentialRemoved: secureValue !== values.current,
        noLocalStorageCredential:
          !localValues.includes(values.current) &&
          !localValues.includes(values.next),
        noSessionStorageCredential:
          !sessionValues.includes(values.current) &&
          !sessionValues.includes(values.next),
        noIndexedDbDatabase: databases.length === 0,
        credentialAbsentFromDom:
          !document.documentElement.textContent.includes(values.current) &&
          !document.documentElement.textContent.includes(values.next),
        credentialAbsentFromUrl:
          !window.location.href.includes(values.current) &&
          !window.location.href.includes(values.next),
      };
    }, {
      current: CURRENT_CREDENTIAL,
      next: NEXT_CREDENTIAL,
    });

    expect({
      refreshCalls,
      authenticationCalls,
      loginCalls,
      safeRequestContract,
      safeAuthenticationContract,
      consoleLeakDetected,
      storageSummary,
    }).toEqual({
      refreshCalls: 1,
      authenticationCalls: 1,
      loginCalls: 0,
      safeRequestContract: {
        exactBody: true,
        requestKeyIsUuid: true,
        bearerMatches: true,
        noCookie: true,
      },
      safeAuthenticationContract: {
        method: 'GET',
        bearerMatches: true,
        noBody: true,
        noCookie: true,
      },
      consoleLeakDetected: false,
      storageSummary: {
        secureCredentialReplaced: true,
        oldCredentialRemoved: true,
        noLocalStorageCredential: true,
        noSessionStorageCredential: true,
        noIndexedDbDatabase: true,
        credentialAbsentFromDom: true,
        credentialAbsentFromUrl: true,
      },
    });
  });

  test('removes an invalid stored credential and performs one fresh Telegram login', async ({
    page,
  }) => {
    let refreshCalls = 0;
    let loginCalls = 0;
    await prepareTelegramWithSecureStorage(page, CURRENT_CREDENTIAL);
    await page.route(REFRESH_ROUTE, async (route) => {
      refreshCalls += 1;
      await fulfillJson(route, 401, {
        statusCode: 401,
        code: 'session_invalid',
        message: 'Session is invalid',
      });
    });
    await page.route(LOGIN_ROUTE, async (route) => {
      loginCalls += 1;
      await fulfillJson(route, 200, {
        credential: LOGIN_CREDENTIAL,
        expiresAt: futureExpiry(),
        accountKind: 'existing',
      });
    });

    await page.goto('/');
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveAttribute('data-status', 'authenticated');

    const replacementStored = await page.evaluate((expected) =>
      new Promise((resolve) => {
        window.Telegram.WebApp.SecureStorage.getItem(
          'prosto_padel_backend_session_v1',
          (_error, value) => resolve(value === expected),
        );
      }), LOGIN_CREDENTIAL);

    expect({ refreshCalls, loginCalls, replacementStored }).toEqual({
      refreshCalls: 1,
      loginCalls: 1,
      replacementStored: true,
    });
  });

  test('discards a rotated credential rejected by session me before a fresh Telegram login', async ({
    page,
  }) => {
    let refreshCalls = 0;
    let authenticationCalls = 0;
    let loginCalls = 0;

    await prepareTelegramWithSecureStorage(page, CURRENT_CREDENTIAL);
    await page.route(REFRESH_ROUTE, async (route) => {
      refreshCalls += 1;
      await fulfillJson(route, 200, {
        credential: NEXT_CREDENTIAL,
        expiresAt: futureExpiry(),
      });
    });
    await page.unroute(SESSION_ME_ROUTE);
    await page.route(SESSION_ME_ROUTE, async (route) => {
      authenticationCalls += 1;
      const authorization = route.request().headers().authorization;
      if (authorization === `Bearer ${NEXT_CREDENTIAL}`) {
        await fulfillJson(route, 401, {
          statusCode: 401,
          code: 'session_invalid',
          message: 'Session is invalid',
        });
        return;
      }
      await fulfillJson(route, 200, {
        accountId: SYNTHETIC_ACCOUNT_ID,
        role: 'player',
        expiresAt: futureExpiry(),
      });
    });
    await page.route(LOGIN_ROUTE, async (route) => {
      loginCalls += 1;
      await fulfillJson(route, 200, {
        credential: LOGIN_CREDENTIAL,
        expiresAt: futureExpiry(),
        accountKind: 'existing',
      });
    });

    await page.goto('/');
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveAttribute('data-status', 'authenticated');

    const replacementStored = await page.evaluate((expected) =>
      new Promise((resolve) => {
        window.Telegram.WebApp.SecureStorage.getItem(
          'prosto_padel_backend_session_v1',
          (_error, value) => resolve(value === expected),
        );
      }), LOGIN_CREDENTIAL);

    expect({
      refreshCalls,
      authenticationCalls,
      loginCalls,
      replacementStored,
    }).toEqual({
      refreshCalls: 1,
      authenticationCalls: 2,
      loginCalls: 1,
      replacementStored: true,
    });
  });

  test('does not hide a temporary refresh failure behind Telegram login', async ({
    page,
  }) => {
    let refreshCalls = 0;
    let loginCalls = 0;
    await prepareTelegramWithSecureStorage(page, CURRENT_CREDENTIAL);
    await page.route(REFRESH_ROUTE, async (route) => {
      refreshCalls += 1;
      await fulfillJson(route, 503, {
        statusCode: 503,
        code: 'session_service_unavailable',
        message: 'Session service is unavailable',
      });
    });
    await page.route(LOGIN_ROUTE, async (route) => {
      loginCalls += 1;
      await fulfillJson(route, 200, {
        credential: LOGIN_CREDENTIAL,
        expiresAt: futureExpiry(),
        accountKind: 'existing',
      });
    });

    await page.goto('/');
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveAttribute('data-status', 'temporary_unavailable');

    expect({ refreshCalls, loginCalls }).toEqual({
      refreshCalls: 3,
      loginCalls: 0,
    });
  });

  test('removes the consumed stored credential when persisting its rotation fails', async ({
    page,
  }) => {
    await prepareTelegramWithSecureStorage(page, null, '');
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createTelegramBackendLoginLifecycle } = await import(
        '/src/hooks/useTelegramBackendLogin.js'
      );
      let stored = parameters.current;
      let removeCalls = 0;
      let loginCalls = 0;
      const statuses = [];
      const lifecycle = createTelegramBackendLoginLifecycle({
        fingerprint: async () => 'synthetic-write-failure-fingerprint',
        client: {
          async login() {
            loginCalls += 1;
            throw new Error('must not login');
          },
        },
        sessions: {
          async refresh(credential) {
            if (credential !== parameters.current) {
              return { outcome: 'rejected', reason: 'internal_error' };
            }
            return {
              outcome: 'refreshed',
              credential: parameters.next,
              expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
            };
          },
          async authenticate(credential) {
            if (credential !== parameters.next) {
              return { outcome: 'rejected', reason: 'internal_error' };
            }
            return {
              outcome: 'authenticated',
              principal: {
                accountId: '11111111-1111-4111-8111-111111111111',
                role: 'player',
                expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
              },
            };
          },
        },
        credentialStorage: {
          async read() {
            return { outcome: 'found', credential: stored };
          },
          async write() {
            return { outcome: 'failed' };
          },
          async remove() {
            removeCalls += 1;
            stored = null;
            return { outcome: 'removed' };
          },
        },
      });
      lifecycle.attach(
        'synthetic-write-failure-init-data',
        (snapshot) => statuses.push(snapshot.status),
      );
      for (let index = 0; index < 100; index += 1) {
        if (statuses.at(-1) === 'session_restored') break;
        await Promise.resolve();
      }

      return {
        status: statuses.at(-1),
        loginCalls,
        removeCalls,
        staleCredentialRemoved: stored === null,
        rotatedCredentialInMemory: lifecycle.hasCredential(),
      };
    }, {
      current: CURRENT_CREDENTIAL,
      next: NEXT_CREDENTIAL,
    });

    expect(summary).toEqual({
      status: 'session_restored',
      loginCalls: 0,
      removeCalls: 1,
      staleCredentialRemoved: true,
      rotatedCredentialInMemory: true,
    });
  });

  test('uses one requestKey for refresh retries and maps a lost response safely', async ({
    page,
  }) => {
    await prepareTelegramWithSecureStorage(page, null, '');
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createBackendSessionClient } = await import(
        '/src/lib/backendSessionClient.js'
      );
      const requestKeys = [];
      let calls = 0;
      const client = createBackendSessionClient({
        cryptoImpl: {
          randomUUID: () => parameters.requestKey,
        },
        random: () => 0,
        sleep: async () => true,
        fetchImpl: async (_url, options) => {
          calls += 1;
          requestKeys.push(JSON.parse(options.body).requestKey);
          if (calls === 1) {
            throw new TypeError('synthetic network failure');
          }
          return new Response(JSON.stringify({
            statusCode: 409,
            code: 'session_refresh_reopen_required',
            message: 'Reopen',
          }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
      const result = await client.refresh(parameters.credential);
      return {
        calls,
        sameRequestKey:
          requestKeys.length === 2 &&
          requestKeys.every((value) => value === parameters.requestKey),
        outcome: result.outcome,
        reason: result.reason,
        exposesCredential:
          Object.prototype.hasOwnProperty.call(result, 'credential'),
      };
    }, {
      credential: CURRENT_CREDENTIAL,
      requestKey: FIXED_REQUEST_KEY,
    });

    expect(summary).toEqual({
      calls: 2,
      sameRequestKey: true,
      outcome: 'rejected',
      reason: 'reopen_required',
      exposesCredential: false,
    });
  });

  test('times out a refresh body that stalls after response headers', async ({
    page,
  }) => {
    await prepareTelegramWithSecureStorage(page, null, '');
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createBackendSessionClient } = await import(
        '/src/lib/backendSessionClient.js'
      );
      const requestKeys = [];
      let calls = 0;
      const client = createBackendSessionClient({
        cryptoImpl: {
          randomUUID: () => parameters.requestKey,
        },
        requestTimeoutMs: 5,
        random: () => 0,
        sleep: async () => true,
        fetchImpl: async (_url, options) => {
          calls += 1;
          requestKeys.push(JSON.parse(options.body).requestKey);
          if (calls === 1) {
            return new Response(new ReadableStream({
              start() {},
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({
            statusCode: 409,
            code: 'session_refresh_reopen_required',
            message: 'Reopen',
          }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
      const result = await client.refresh(parameters.credential);
      return {
        calls,
        sameRequestKey:
          requestKeys.length === 2 &&
          requestKeys.every((value) => value === parameters.requestKey),
        outcome: result.outcome,
        reason: result.reason,
      };
    }, {
      credential: CURRENT_CREDENTIAL,
      requestKey: FIXED_REQUEST_KEY,
    });

    expect(summary).toEqual({
      calls: 2,
      sameRequestKey: true,
      outcome: 'rejected',
      reason: 'reopen_required',
    });
  });

  test('authenticates the rotated credential with an exact no-store GET and rejects extra fields', async ({
    page,
  }) => {
    await prepareTelegramWithSecureStorage(page, null, '');
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createBackendSessionClient } = await import(
        '/src/lib/backendSessionClient.js'
      );
      const contracts = [];
      let calls = 0;
      const client = createBackendSessionClient({
        fetchImpl: async (url, options) => {
          calls += 1;
          contracts.push({
            pathMatches: url === '/api/v1/auth/session/me',
            method: options.method,
            bearerMatches:
              options.headers.Authorization ===
              `Bearer ${parameters.credential}`,
            noBody:
              !Object.prototype.hasOwnProperty.call(options, 'body'),
            cache: options.cache,
            credentials: options.credentials,
            redirect: options.redirect,
          });
          const body = {
            accountId: parameters.accountId,
            role: 'player',
            expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
          };
          if (calls === 2) {
            body.sessionId = '22222222-2222-4222-8222-222222222222';
          }
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      const accepted = await client.authenticate(parameters.credential);
      const malformed = await client.authenticate(parameters.credential);
      return {
        calls,
        contracts,
        acceptedOutcome: accepted.outcome,
        acceptedRole: accepted.principal?.role ?? null,
        acceptedExpiresAtIsFuture:
          accepted.principal?.expiresAt >
          Math.floor(Date.now() / 1_000),
        acceptedExposesCredential:
          Object.prototype.hasOwnProperty.call(accepted, 'credential'),
        malformedOutcome: malformed.outcome,
        malformedReason: malformed.reason,
        malformedExposesPrincipal:
          Object.prototype.hasOwnProperty.call(malformed, 'principal'),
      };
    }, {
      credential: NEXT_CREDENTIAL,
      accountId: SYNTHETIC_ACCOUNT_ID,
    });

    expect(summary).toEqual({
      calls: 2,
      contracts: [
        {
          pathMatches: true,
          method: 'GET',
          bearerMatches: true,
          noBody: true,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
        },
        {
          pathMatches: true,
          method: 'GET',
          bearerMatches: true,
          noBody: true,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
        },
      ],
      acceptedOutcome: 'authenticated',
      acceptedRole: 'player',
      acceptedExpiresAtIsFuture: true,
      acceptedExposesCredential: false,
      malformedOutcome: 'rejected',
      malformedReason: 'internal_error',
      malformedExposesPrincipal: false,
    });
  });

  test('logout client sends an exact credential-bound request and accepts only 204', async ({
    page,
  }) => {
    await prepareTelegramWithSecureStorage(page, null, '');
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createBackendSessionClient } = await import(
        '/src/lib/backendSessionClient.js'
      );
      let safeContract = null;
      let calls = 0;
      const client = createBackendSessionClient({
        cryptoImpl: {
          randomUUID: () => parameters.requestKey,
        },
        fetchImpl: async (url, options) => {
          calls += 1;
          const body = JSON.parse(options.body);
          safeContract = {
            pathMatches: url === '/api/v1/auth/session/logout',
            method: options.method,
            exactBody:
              Object.keys(body).join(',') === 'requestKey' &&
              body.requestKey === parameters.requestKey,
            bearerMatches:
              options.headers.Authorization ===
              `Bearer ${parameters.credential}`,
            cache: options.cache,
            credentials: options.credentials,
            redirect: options.redirect,
          };
          return new Response(null, { status: 204 });
        },
      });
      const result = await client.logout(parameters.credential);
      return {
        calls,
        safeContract,
        outcome: result.outcome,
        resultExposesCredential:
          Object.prototype.hasOwnProperty.call(result, 'credential'),
      };
    }, {
      credential: CURRENT_CREDENTIAL,
      requestKey: FIXED_REQUEST_KEY,
    });

    expect(summary).toEqual({
      calls: 1,
      safeContract: {
        pathMatches: true,
        method: 'POST',
        exactBody: true,
        bearerMatches: true,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
      outcome: 'logged_out',
      resultExposesCredential: false,
    });
  });

  test('revokes the private credential once and clears storage on logout', async ({
    page,
  }) => {
    await prepareTelegramWithSecureStorage(page, null, '');
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createTelegramBackendLoginLifecycle } = await import(
        '/src/hooks/useTelegramBackendLogin.js'
      );
      let stored = null;
      let loginCalls = 0;
      let logoutCalls = 0;
      let presentedCredentialMatched = false;
      let removeCalls = 0;
      const lifecycle = createTelegramBackendLoginLifecycle({
        fingerprint: async () => 'synthetic-logout-fingerprint',
        client: {
          async login() {
            loginCalls += 1;
            return {
              outcome: 'authenticated',
              credential: parameters.credential,
              expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
              accountKind: 'existing',
            };
          },
        },
        sessions: {
          async refresh() {
            throw new Error('must not refresh');
          },
          async logout(credential) {
            logoutCalls += 1;
            presentedCredentialMatched =
              credential === parameters.credential;
            return { outcome: 'logged_out' };
          },
          async authenticate(credential) {
            if (credential !== parameters.credential) {
              return { outcome: 'rejected', reason: 'internal_error' };
            }
            return {
              outcome: 'authenticated',
              principal: {
                accountId: '11111111-1111-4111-8111-111111111111',
                role: 'player',
                expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
              },
            };
          },
        },
        credentialStorage: {
          async read() {
            return { outcome: 'empty' };
          },
          async write(credential) {
            stored = credential;
            return { outcome: 'stored' };
          },
          async remove() {
            removeCalls += 1;
            stored = null;
            return { outcome: 'removed' };
          },
        },
      });
      const waitFor = async (predicate) => {
        for (let index = 0; index < 100; index += 1) {
          if (predicate()) return true;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return false;
      };
      lifecycle.attach(
        'synthetic-logout-init-data',
        () => {},
      );
      await waitFor(() => lifecycle.hasPrincipal());
      const principalBeforeLogout = lifecycle.hasPrincipal();
      const result = await lifecycle.logout();

      return {
        result,
        loginCalls,
        logoutCalls,
        presentedCredentialMatched,
        removeCalls,
        storageEmpty: stored === null,
        memoryEmpty: !lifecycle.hasCredential(),
        principalBeforeLogout,
        principalEmpty: !lifecycle.hasPrincipal(),
        resultExposesCredential:
          Object.prototype.hasOwnProperty.call(result, 'credential'),
      };
    }, { credential: CURRENT_CREDENTIAL });

    expect(summary).toEqual({
      result: { outcome: 'logged_out' },
      loginCalls: 1,
      logoutCalls: 1,
      presentedCredentialMatched: true,
      removeCalls: 1,
      storageEmpty: true,
      memoryEmpty: true,
      principalBeforeLogout: true,
      principalEmpty: true,
      resultExposesCredential: false,
    });
  });

  test('keeps persisted credential on final unmount but removes it on explicit clear', async ({
    page,
  }) => {
    await prepareTelegramWithSecureStorage(page, null, '');
    await page.goto('/');

    const summary = await page.evaluate(async (credential) => {
      const { createTelegramBackendLoginLifecycle } = await import(
        '/src/hooks/useTelegramBackendLogin.js'
      );
      let stored = null;
      let removeCalls = 0;
      const timers = [];
      const lifecycle = createTelegramBackendLoginLifecycle({
        fingerprint: async () => 'synthetic-persistence-fingerprint',
        setTimer(callback, delay) {
          timers.push({ callback, delay });
          return timers.length;
        },
        clearTimer() {},
        client: {
          async login() {
            return {
              outcome: 'authenticated',
              credential,
              expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
              accountKind: 'existing',
            };
          },
        },
        credentialStorage: {
          async read() {
            return { outcome: 'empty' };
          },
          async write(value) {
            stored = value;
            return { outcome: 'stored' };
          },
          async remove() {
            removeCalls += 1;
            stored = null;
            return { outcome: 'removed' };
          },
        },
      });
      const waitFor = async (predicate) => {
        for (let index = 0; index < 100; index += 1) {
          if (predicate()) return true;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return false;
      };
      const detach = lifecycle.attach(
        'synthetic-persistence-init-data',
        () => {},
      );
      await waitFor(() => lifecycle.hasPrincipal());
      detach();
      const teardown = timers.find((timer) => timer.delay === 0);
      teardown.callback();
      const afterUnmount = {
        memoryEmpty: !lifecycle.hasCredential(),
        principalEmpty: !lifecycle.hasPrincipal(),
        storageRetained: stored === credential,
        removeCalls,
      };
      lifecycle.clear();
      await Promise.resolve();

      return {
        afterUnmount,
        afterClear: {
          memoryEmpty: !lifecycle.hasCredential(),
          principalEmpty: !lifecycle.hasPrincipal(),
          storageEmpty: stored === null,
          removeCalls,
        },
      };
    }, CURRENT_CREDENTIAL);

    expect(summary).toEqual({
      afterUnmount: {
        memoryEmpty: true,
        principalEmpty: true,
        storageRetained: true,
        removeCalls: 0,
      },
      afterClear: {
        memoryEmpty: true,
        principalEmpty: true,
        storageEmpty: true,
        removeCalls: 1,
      },
    });
  });

  test('serializes stale credential removal before persisting a new identity', async ({
    page,
  }) => {
    await prepareTelegramWithSecureStorage(page, null, '');
    await page.goto('/');

    const summary = await page.evaluate(async (parameters) => {
      const { createTelegramBackendLoginLifecycle } = await import(
        '/src/hooks/useTelegramBackendLogin.js'
      );
      let stored = null;
      let releaseRemoval;
      const writes = [];
      const statuses = [];
      const lifecycle = createTelegramBackendLoginLifecycle({
        fingerprint: async (rawInitData) => `fingerprint:${rawInitData}`,
        client: {
          async login(rawInitData) {
            return {
              outcome: 'authenticated',
              credential:
                rawInitData === 'first-init-data'
                  ? parameters.current
                  : parameters.next,
              expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
              accountKind: 'existing',
            };
          },
        },
        credentialStorage: {
          async read() {
            return { outcome: 'empty' };
          },
          async write(credential) {
            writes.push(credential);
            stored = credential;
            return { outcome: 'stored' };
          },
          async remove() {
            await new Promise((resolve) => {
              releaseRemoval = resolve;
            });
            stored = null;
            return { outcome: 'removed' };
          },
        },
      });
      const waitFor = async (predicate) => {
        for (let index = 0; index < 100; index += 1) {
          if (predicate()) return true;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return false;
      };

      lifecycle.attach(
        'first-init-data',
        (snapshot) => statuses.push(snapshot.status),
      );
      await waitFor(() => stored === parameters.current);
      lifecycle.attach(
        'second-init-data',
        (snapshot) => statuses.push(snapshot.status),
      );
      await waitFor(() => typeof releaseRemoval === 'function');
      const beforeRemovalCompletes = {
        oldCredentialStillStored: stored === parameters.current,
        newCredentialNotWritten: writes.length === 1,
      };
      releaseRemoval();
      await waitFor(
        () =>
          stored === parameters.next &&
          lifecycle.hasCredential() &&
          lifecycle.hasPrincipal() &&
          statuses.at(-1) === 'authenticated',
      );

      return {
        beforeRemovalCompletes,
        finalCredentialIsNew: stored === parameters.next,
        writesInOrder:
          writes.length === 2 &&
          writes[0] === parameters.current &&
          writes[1] === parameters.next,
        hasCredential: lifecycle.hasCredential(),
        finalStatus: statuses.at(-1),
      };
    }, {
      current: CURRENT_CREDENTIAL,
      next: NEXT_CREDENTIAL,
    });

    expect(summary).toEqual({
      beforeRemovalCompletes: {
        oldCredentialStillStored: true,
        newCredentialNotWritten: true,
      },
      finalCredentialIsNew: true,
      writesInOrder: true,
      hasCredential: true,
      finalStatus: 'authenticated',
    });
  });

  test('SecureStorage adapter fails closed on unsupported clients without browser-storage fallback', async ({
    page,
  }) => {
    await prepareTelegramWithSecureStorage(page, null, '');
    await page.goto('/');

    const summary = await page.evaluate(async (credential) => {
      const { createTelegramSecureCredentialStorage } = await import(
        '/src/lib/telegramSecureCredentialStorage.js'
      );
      let secureCalls = 0;
      const storage = createTelegramSecureCredentialStorage({
        getWebApp: () => ({
          isVersionAtLeast: () => false,
          SecureStorage: {
            getItem() {
              secureCalls += 1;
            },
            setItem() {
              secureCalls += 1;
            },
            removeItem() {
              secureCalls += 1;
            },
          },
        }),
      });
      const read = await storage.read();
      const write = await storage.write(credential);
      const remove = await storage.remove();

      return {
        outcomes: [read.outcome, write.outcome, remove.outcome],
        secureCalls,
        localStorageHasCredential:
          Object.values(window.localStorage).includes(credential),
        sessionStorageHasCredential:
          Object.values(window.sessionStorage).includes(credential),
      };
    }, CURRENT_CREDENTIAL);

    expect(summary).toEqual({
      outcomes: ['unavailable', 'unavailable', 'unavailable'],
      secureCalls: 0,
      localStorageHasCredential: false,
      sessionStorageHasCredential: false,
    });
  });
});

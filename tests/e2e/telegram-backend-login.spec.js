const { test, expect } = require('@playwright/test');

const FEATURE_SETTING =
  process.env.VITE_TELEGRAM_BACKEND_LOGIN_ENABLED;
const FEATURE_ENABLED =
  FEATURE_SETTING === undefined || FEATURE_SETTING === 'true';
const LOGIN_ROUTE = '**/api/v1/auth/telegram/login';
const SESSION_ME_ROUTE = '**/api/v1/auth/session/me';
const PROFILE_ROUTE = '**/api/v1/profile/me';
const ONBOARDING_ROUTE = '**/api/v1/onboarding/me';
const ONBOARDING_PROGRESS_ROUTE = '**/api/v1/onboarding/me/progress';
const ONBOARDING_COMPLETE_ROUTE = '**/api/v1/onboarding/me/complete';
const TELEGRAM_SDK_ROUTE = 'https://telegram.org/js/telegram-web-app.js';
const SYNTHETIC_INIT_DATA =
  'query_id=synthetic-login&auth_date=1700000000&hash=synthetic-hash';
const SYNTHETIC_CREDENTIAL =
  'Q0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0M';
const SYNTHETIC_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
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

function onboardingState(overrides = {}) {
  return {
    status: 'completed',
    flowVersion: 'tma_v1',
    currentStep: 'completed',
    surveyVersion: 'initial_level_v1',
    revision: 4,
    profile: { firstName: 'Synthetic', lastName: 'Player' },
    contacts: {
      phone: '+79991234567',
      normalizedEmail: 'synthetic@example.com',
      assurance: 'declared',
    },
    consents: [
      { kind: 'terms', documentVersion: 'synthetic-v1' },
      { kind: 'privacy', documentVersion: 'synthetic-v1' },
      { kind: 'cancellation', documentVersion: 'synthetic-v1' },
    ],
    surveyAnswers: { experience: 'beginner' },
    ...overrides,
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
  await page.route(TELEGRAM_SDK_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '',
    });
  });

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

async function fulfillOnboardingJson(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  });
}

async function expectBackendApp(page) {
  await expect(page.locator('.bottom-nav')).toBeVisible();
}

test.describe('Telegram backend login feature disabled', () => {
  test.skip(
    FEATURE_ENABLED,
    'This regression requires an explicitly disabled backend-login build.',
  );

  test('fails closed without the mandatory backend login feature', async ({
    page,
  }) => {
    let loginCalls = 0;
    let sessionCalls = 0;
    let profileCalls = 0;
    let onboardingCalls = 0;
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      loginCalls += 1;
      await fulfillJson(route, 200, successBody());
    });
    await page.route(SESSION_ME_ROUTE, async (route) => {
      sessionCalls += 1;
      await fulfillJson(route, 200, {
        accountId: SYNTHETIC_ACCOUNT_ID,
        role: 'player',
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      });
    });
    await page.route(PROFILE_ROUTE, async (route) => {
      profileCalls += 1;
      await fulfillJson(route, 200, {
        accountId: SYNTHETIC_ACCOUNT_ID,
        role: 'player',
        firstName: 'Synthetic',
        lastName: 'Player',
        username: 'synthetic_player',
        photoUrl: null,
        languageCode: 'ru',
        phone: null,
        sidePreference: null,
      });
    });
    await page.route(ONBOARDING_ROUTE, async (route) => {
      onboardingCalls += 1;
      await fulfillOnboardingJson(route, 200, onboardingState());
    });

    await page.goto('/');
    await expect(page.locator('.bottom-nav')).toHaveCount(0);
    await page.waitForTimeout(300);

    expect({ loginCalls, sessionCalls, profileCalls, onboardingCalls }).toEqual({
      loginCalls: 0,
      sessionCalls: 0,
      profileCalls: 0,
      onboardingCalls: 0,
    });
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveAttribute('data-status', 'disabled');
  });
});

test.describe('Telegram backend login feature enabled', () => {
  test.skip(
    !FEATURE_ENABLED,
    'This regression requires VITE_TELEGRAM_BACKEND_LOGIN_ENABLED=true.',
  );

  test.beforeEach(async ({ page }) => {
    await page.route(SESSION_ME_ROUTE, async (route) => {
      await fulfillJson(route, 200, {
        accountId: SYNTHETIC_ACCOUNT_ID,
        role: 'player',
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      });
    });
    await page.route(PROFILE_ROUTE, async (route) => {
      await fulfillJson(route, 200, {
        accountId: SYNTHETIC_ACCOUNT_ID,
        role: 'player',
        firstName: 'Synthetic',
        lastName: 'Player',
        username: 'synthetic_player',
        photoUrl: null,
        languageCode: 'ru',
        phone: null,
        sidePreference: null,
      });
    });
    await page.route(ONBOARDING_ROUTE, async (route) => {
      await fulfillOnboardingJson(route, 200, onboardingState());
    });
  });

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
    await expectBackendApp(page);

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

  test('opens the application from the backend session alone', async ({
    page,
  }) => {
    let legacyProviderRequests = 0;
    await prepareBrowser(page);
    await page.unroute(ONBOARDING_ROUTE);
    await page.route(ONBOARDING_ROUTE, async (route) => {
      await fulfillOnboardingJson(
        route,
        200,
        onboardingState({
          surveyVersion: 'initial_level_v2',
          surveyAnswers: {
            match_count: 'one_hundred_plus',
            rally_stability: 'controls_pace',
            glass_play: 'uses_tactically',
            serve_return_net: 'advanced_patterns',
            match_experience_year: 'tournament',
          },
          initialLevelLabel: 'A',
        }),
      );
    });
    await page.route(LOGIN_ROUTE, async (route) => {
      await fulfillJson(route, 200, successBody('existing'));
    });
    await page.route('**/auth/v1/**', async (route) => {
      legacyProviderRequests += 1;
      await route.abort();
    });
    await page.route('**/rest/v1/**', async (route) => {
      legacyProviderRequests += 1;
      await route.abort();
    });
    await page.route('https://*.supabase.co/**', async (route) => {
      legacyProviderRequests += 1;
      await route.abort();
    });

    await page.goto('/');
    const status = page.getByTestId('telegram-backend-login-status');
    await expect(status).toHaveAttribute('data-status', 'authenticated');
    await expectBackendApp(page);
    await expect(
      page.getByTestId('onboarding-initial-level-result-gate'),
    ).toHaveCount(0);
    expect(legacyProviderRequests).toBe(0);
  });

  test('keeps first-run profile and legal readiness on one fail-closed screen without persisting PII', async ({
    page,
  }) => {
    const phone = '+7 (999) 123-45-67';
    const canonicalPhone = '+79991234567';
    const email = 'PLAYER@EXAMPLE.COM';
    let readCalls = 0;
    let patchCalls = 0;
    let progressCalls = 0;
    let completionCalls = 0;
    let patchContract = null;
    let piiConsoleLeak = false;

    page.on('console', (message) => {
      const text = message.text();
      if (text.includes(canonicalPhone) || text.includes(email)) {
        piiConsoleLeak = true;
      }
    });
    await page.unroute(ONBOARDING_ROUTE);
    await page.route(ONBOARDING_ROUTE, async (route) => {
      const request = route.request();
      if (request.method() === 'PATCH') {
        patchCalls += 1;
        const headers = request.headers();
        const body = request.postDataJSON();
        patchContract = {
          body,
          bearerMatches:
            headers.authorization === `Bearer ${SYNTHETIC_CREDENTIAL}`,
          noCookie:
            !Object.prototype.hasOwnProperty.call(headers, 'cookie'),
        };
        await fulfillOnboardingJson(route, 200, onboardingState({
          status: 'in_progress',
          currentStep: 'profile',
          revision: 1,
          profile: { firstName: 'Анна', lastName: 'Петрова' },
          contacts: {
            phone: canonicalPhone,
            normalizedEmail: 'player@example.com',
            assurance: 'declared',
          },
          consents: [],
          surveyAnswers: {},
        }));
        return;
      }
      readCalls += 1;
      await fulfillOnboardingJson(route, 200, onboardingState({
        status: 'required',
        flowVersion: null,
        currentStep: 'profile',
        surveyVersion: null,
        revision: null,
        profile: { firstName: 'Synthetic', lastName: null },
        contacts: {
          phone: null,
          normalizedEmail: null,
          assurance: 'declared',
        },
        consents: [],
        surveyAnswers: {},
      }));
    });
    await page.route(ONBOARDING_PROGRESS_ROUTE, async (route) => {
      progressCalls += 1;
      await fulfillOnboardingJson(route, 200, onboardingState({
        status: 'in_progress',
        currentStep: 'consents',
        revision: 2,
        profile: { firstName: 'Анна', lastName: 'Петрова' },
        contacts: {
          phone: canonicalPhone,
          normalizedEmail: 'player@example.com',
          assurance: 'declared',
        },
        consents: [],
        surveyAnswers: {},
      }));
    });
    await page.route(ONBOARDING_COMPLETE_ROUTE, async (route) => {
      completionCalls += 1;
      await route.abort();
    });
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      await fulfillJson(route, 200, successBody('new'));
    });

    await page.goto('/');
    const gate = page.getByTestId('onboarding-profile-gate');
    await expect(gate).toBeVisible();
    await expect(
      page.getByTestId('telegram-backend-login-status'),
    ).toHaveCount(0);
    await expect(page.locator('.bottom-nav')).toHaveCount(0);
    await page.getByLabel('Имя *').fill('  Анна  ');
    await page.getByLabel('Фамилия').fill('  Петрова  ');
    await page.getByLabel('Телефон *').fill(phone);
    await page.getByLabel('Email *').fill(email);
    await expect(
      page.getByTestId('onboarding-legal-unavailable-note'),
    ).toBeVisible();
    await expect(page.getByText(/Черновики не используются/u)).toBeVisible();
    await expect(page.getByTestId('onboarding-consents-gate')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('link')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Продолжить' })).toBeDisabled();
    expect(readCalls).toBe(1);
    expect(patchCalls).toBe(0);
    expect(progressCalls).toBe(0);
    expect(completionCalls).toBe(0);
    expect(patchContract).toBeNull();
    const persistence = await page.evaluate(({ phoneValue, emailValue }) => ({
      localStorage: Object.values(window.localStorage).some(
        (value) => value.includes(phoneValue) || value.includes(emailValue),
      ),
      sessionStorage: Object.values(window.sessionStorage).some(
        (value) => value.includes(phoneValue) || value.includes(emailValue),
      ),
    }), { phoneValue: canonicalPhone, emailValue: email });
    expect(persistence).toEqual({ localStorage: false, sessionStorage: false });
    expect(piiConsoleLeak).toBe(false);
  });

  test('resumes the current owner profile draft on the combined fail-closed screen', async ({
    page,
  }) => {
    let submittedRevision = null;
    let progressCalls = 0;
    const resume = onboardingState({
      status: 'in_progress',
      currentStep: 'profile',
      revision: 6,
      profile: { firstName: 'Ирина', lastName: 'Соколова' },
      contacts: {
        phone: '+79990001122',
        normalizedEmail: 'irina@example.com',
        assurance: 'declared',
      },
      consents: [],
      surveyAnswers: {},
    });
    await page.unroute(ONBOARDING_ROUTE);
    await page.route(ONBOARDING_ROUTE, async (route) => {
      if (route.request().method() === 'PATCH') {
        submittedRevision = route.request().postDataJSON().expectedRevision;
      }
      await fulfillOnboardingJson(route, 200, resume);
    });
    await page.route(ONBOARDING_PROGRESS_ROUTE, async (route) => {
      progressCalls += 1;
      await fulfillOnboardingJson(route, 200, onboardingState({
        ...resume,
        currentStep: 'consents',
        revision: 7,
      }));
    });
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      await fulfillJson(route, 200, successBody('existing'));
    });

    await page.goto('/');
    await expect(page.getByLabel('Имя *')).toHaveValue('Ирина');
    await expect(page.getByLabel('Телефон *')).toHaveValue('+79990001122');
    await expect(
      page.getByTestId('onboarding-legal-unavailable-note'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Продолжить' })).toBeDisabled();
    expect(submittedRevision).toBeNull();
    expect(progressCalls).toBe(0);
  });

  test('does not attempt a stale profile PATCH while legal configuration is unavailable', async ({
    page,
  }) => {
    let readCalls = 0;
    let patchCalls = 0;
    const original = onboardingState({
      status: 'in_progress',
      currentStep: 'profile',
      revision: 2,
      profile: { firstName: 'Старая', lastName: null },
      contacts: {
        phone: '+79990001122',
        normalizedEmail: 'old@example.com',
        assurance: 'declared',
      },
      consents: [],
      surveyAnswers: {},
    });
    const refreshed = onboardingState({
      status: 'in_progress',
      currentStep: 'profile',
      revision: 3,
      profile: { firstName: 'Новая', lastName: 'Версия' },
      contacts: {
        phone: '+79995554433',
        normalizedEmail: 'new@example.com',
        assurance: 'declared',
      },
      consents: [],
      surveyAnswers: {},
    });
    await page.unroute(ONBOARDING_ROUTE);
    await page.route(ONBOARDING_ROUTE, async (route) => {
      if (route.request().method() === 'PATCH') {
        patchCalls += 1;
        await fulfillOnboardingJson(route, 409, {
          statusCode: 409,
          code: 'onboarding_draft_revision_conflict',
          message: 'Synthetic conflict',
        });
        return;
      }
      readCalls += 1;
      await fulfillOnboardingJson(route, 200, readCalls === 1 ? original : refreshed);
    });
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      await fulfillJson(route, 200, successBody('existing'));
    });

    await page.goto('/');
    await expect(page.getByLabel('Имя *')).toHaveValue('Старая');
    await expect(page.getByRole('button', { name: 'Продолжить' })).toBeDisabled();
    await expect(page.getByTestId('onboarding-legal-unavailable-note')).toBeVisible();
    expect({ readCalls, patchCalls }).toEqual({ readCalls: 1, patchCalls: 0 });
  });

  test('clears the private session boundary when onboarding GET is unauthorized', async ({
    page,
  }) => {
    let onboardingCalls = 0;
    await page.unroute(ONBOARDING_ROUTE);
    await page.route(ONBOARDING_ROUTE, async (route) => {
      onboardingCalls += 1;
      await fulfillOnboardingJson(route, 401, {
        statusCode: 401,
        code: 'session_invalid',
        message: 'Synthetic invalid session',
      });
    });
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      await fulfillJson(route, 200, successBody('existing'));
    });

    await page.goto('/');
    await expect.poll(() => onboardingCalls).toBe(1);
    await expect(page.getByTestId('backend-own-profile-gate')).toHaveAttribute(
      'data-state',
      'loading',
    );
    await expect(page.getByTestId('onboarding-profile-gate')).toHaveCount(0);
    await expect(page.locator('.bottom-nav')).toHaveCount(0);
  });

  test('does not expose the legacy profile when the Telegram backend profile is unavailable', async ({
    page,
  }) => {
    await page.unroute(PROFILE_ROUTE);
    await page.route(PROFILE_ROUTE, async (route) => {
      await fulfillJson(route, 503, {
        statusCode: 503,
        code: 'profile_temporarily_unavailable',
        message: 'Synthetic public error',
      });
    });
    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      await fulfillJson(route, 200, successBody('existing'));
    });

    await page.goto('/');
    await expect(
      page.getByTestId('backend-own-profile-gate'),
    ).toHaveAttribute('data-state', 'error');
    const status = page.getByTestId('telegram-backend-login-status');
    await expect(status).toHaveAttribute(
      'data-status',
      'profile_unavailable',
    );
    await expect(status).toContainText(
      'Не удалось загрузить ваш профиль',
    );
    await expect(page.locator('.bottom-nav')).toHaveCount(0);
  });

  test('saves personal information through the backend credential boundary', async ({
    page,
  }) => {
    let profileGets = 0;
    let profilePatches = 0;
    let legacyProfileUpdates = 0;
    let patchContract = null;

    await prepareBrowser(page);
    await page.route(LOGIN_ROUTE, async (route) => {
      await fulfillJson(route, 200, successBody('existing'));
    });
    await page.route(SESSION_ME_ROUTE, async (route) => {
      await fulfillJson(route, 200, {
        accountId: SYNTHETIC_ACCOUNT_ID,
        role: 'player',
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      });
    });
    await page.route(PROFILE_ROUTE, async (route) => {
      const request = route.request();
      if (request.method() === 'PATCH') {
        profilePatches += 1;
        const body = request.postDataJSON();
        const headers = request.headers();
        patchContract = {
          exactKeys:
            Object.keys(body).sort().join(',') ===
            'firstName,lastName,phone,sidePreference',
          hasAccountId:
            Object.prototype.hasOwnProperty.call(body, 'accountId'),
          bearerIsCanonical:
            /^Bearer [A-Za-z0-9_-]{43}$/u.test(
              headers.authorization ?? '',
            ),
          noCookie:
            !Object.prototype.hasOwnProperty.call(headers, 'cookie'),
        };
        if (body.firstName === 'fuck') {
          await fulfillJson(route, 422, {
            statusCode: 422,
            code: 'profile_content_not_allowed',
            message: 'Profile contains disallowed language',
          });
          return;
        }
        await fulfillJson(route, 200, {
          accountId: SYNTHETIC_ACCOUNT_ID,
          role: 'player',
          firstName: body.firstName,
          lastName: body.lastName,
          username: 'synthetic_player',
          photoUrl: null,
          languageCode: 'ru',
          phone: body.phone,
          sidePreference: body.sidePreference,
        });
        return;
      }
      profileGets += 1;
      await fulfillJson(route, 200, {
        accountId: SYNTHETIC_ACCOUNT_ID,
        role: 'player',
        firstName: 'Backend',
        lastName: 'Player',
        username: 'synthetic_player',
        photoUrl: null,
        languageCode: 'ru',
        phone: null,
        sidePreference: null,
      });
    });
    await page.route('**/rest/v1/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/rpc/update_my_profile')) {
        legacyProfileUpdates += 1;
      }
      if (url.includes('/rpc/get_my_profile')) {
        await fulfillJson(route, 200, {
          id: SYNTHETIC_ACCOUNT_ID,
          first_name: 'Legacy',
          last_name: 'Fallback',
          username: 'legacy_profile',
          phone: '+79990000000',
          side_preference: 'Both',
          rating: 3.4,
          is_verified: false,
          role: 'user',
        });
        return;
      }
      if (url.includes('/rpc/get_unread_notification_count')) {
        await fulfillJson(route, 200, 0);
        return;
      }
      await fulfillJson(route, 200, []);
    });

    await page.goto('/');
    await expect.poll(() => profileGets).toBe(1);

    const navigation = page.locator('.bottom-nav');
    await expect(navigation).toBeVisible();
    await navigation.getByRole('button').nth(4).click();
    await page.getByRole('button', { name: 'Настройки' }).click();
    await expect(page.getByRole('button', { name: /Фото профиля/ })).toHaveCount(0);
    await page.getByRole('button', {
      name: /Личная информация/,
    }).click();
    const personalPhotoLauncher = page.getByTestId('personal-info-photo-launcher');
    await expect(personalPhotoLauncher).toBeVisible();
    await personalPhotoLauncher.click();
    await expect(page.getByTestId('profile-photo-actions')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/profile-photo-modal-open/);
    await expect(page.getByTestId('profile-photo-select')).toBeInViewport();
    await page.getByRole('button', { name: 'Закрыть управление фото' }).click();

    const inputs = page.locator('input:not([type="file"])');
    await expect(inputs.nth(0)).toHaveValue('Backend');
    await expect(inputs.nth(2)).toHaveValue('');
    await inputs.nth(0).fill('fuck');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect.poll(() => profilePatches).toBe(1);
    await expect(
      page.getByText('Имя или фамилия содержит недопустимые слова.').first(),
    ).toBeVisible();
    await inputs.nth(0).fill('Updated');
    await inputs.nth(1).fill('');
    await inputs.nth(2).fill('+7 (999) 111-22-33');
    const sideButtons = page
      .locator('label')
      .filter({ has: page.locator('button') })
      .getByRole('button');
    await sideButtons.nth(0).click();
    await page.getByRole('button', { name: 'Сохранить' }).click();

    await expect.poll(() => profilePatches).toBe(2);
    expect(patchContract).toEqual({
      exactKeys: true,
      hasAccountId: false,
      bearerIsCanonical: true,
      noCookie: true,
    });
    expect(legacyProfileUpdates).toBe(0);
    await expect(
      page.getByText('Профиль сохранен', { exact: true }),
    ).toBeVisible();
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
          await new Promise((resolve) => setTimeout(resolve, 0));
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
        credential: 'REREREREREREREREREREREREREREREREREREREREREQ',
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
      await expect(page.locator('.bottom-nav')).toHaveCount(0);
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
        credential: 'RkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkY',
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
                  credential: 'R0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0c',
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
            credential: 'SEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEg',
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

      await waitFor(() => lifecycle.hasPrincipal());
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
            credential: 'SUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUlJSUk',
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
        lifecycle.hasPrincipal() &&
        secondStatuses.at(-1) === 'authenticated');

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
            credential: 'SkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSko',
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
              credential: 'RUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUU',
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

});

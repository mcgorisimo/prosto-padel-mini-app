const { test, expect } = require('@playwright/test');

const LOGIN_ROUTE = '**/api/v1/auth/telegram/login';
const SESSION_ME_ROUTE = '**/api/v1/auth/session/me';
const PROFILE_ROUTE = '**/api/v1/profile/me';
const ONBOARDING_ROUTE = '**/api/v1/onboarding/me';
const REASSESSMENT_ROUTE =
  /\/api\/v1\/onboarding\/me\/initial-level-reassessment$/u;
const REASSESSMENT_COMPLETE_ROUTE =
  /\/api\/v1\/onboarding\/me\/initial-level-reassessment\/complete$/u;
const TELEGRAM_SDK_ROUTE = 'https://telegram.org/js/telegram-web-app.js';
const SYNTHETIC_INIT_DATA =
  'query_id=reassessment-ui&auth_date=1700000000&hash=synthetic-hash';
const SYNTHETIC_CREDENTIAL = 'U1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU1NTU1M';
const SYNTHETIC_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

test.use({
  trace: 'off',
  video: 'off',
  screenshot: 'off',
});

function legacyCompletedOnboarding() {
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
      { kind: 'terms', documentVersion: 'terms-2026-08-26-v1' },
      {
        kind: 'cancellation',
        documentVersion: 'cancellation-2026-08-26-v1',
      },
      {
        kind: 'personal_data_processing',
        documentVersion: 'personal-data-consent-2026-08-26-v1',
      },
    ],
    surveyAnswers: { experience: 'beginner' },
  };
}

function requiredReassessment(revision = 4) {
  return {
    status: 'required',
    source: {
      flowVersion: 'tma_v1',
      surveyVersion: 'initial_level_v1',
      revision,
    },
    surveyVersion: 'initial_level_v2',
  };
}

function completedReassessment(initialLevelLabel = 'D+') {
  return {
    status: 'completed',
    surveyVersion: 'initial_level_v2',
    initialLevelLabel,
  };
}

async function fulfillJson(route, status, body, noStore = false) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: noStore ? { 'Cache-Control': 'no-store' } : undefined,
    body: JSON.stringify(body),
  });
}

async function prepareBrowser(page) {
  await page.route(TELEGRAM_SDK_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '',
    });
  });
  await page.addInitScript((initData) => {
    window.sessionStorage.setItem('prosto-padel-splash-shown', 'true');
    window.Telegram = {
      WebApp: {
        initData,
        initDataUnsafe: {
          user: {
            id: 223344556,
            first_name: 'Synthetic',
            last_name: 'Player',
          },
        },
        ready() {},
        expand() {},
        disableVerticalSwipes() {},
        HapticFeedback: { impactOccurred() {} },
      },
    };
  }, SYNTHETIC_INIT_DATA);
  await page.route(LOGIN_ROUTE, async (route) => {
    await fulfillJson(route, 200, {
      credential: SYNTHETIC_CREDENTIAL,
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      accountKind: 'existing',
    });
  });
  await page.route(SESSION_ME_ROUTE, async (route) => {
    await fulfillJson(
      route,
      200,
      {
        accountId: SYNTHETIC_ACCOUNT_ID,
        role: 'player',
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      },
      true,
    );
  });
  await page.route(PROFILE_ROUTE, async (route) => {
    await fulfillJson(
      route,
      200,
      {
        accountId: SYNTHETIC_ACCOUNT_ID,
        role: 'player',
        firstName: 'Synthetic',
        lastName: 'Player',
        username: 'synthetic_player',
        photoUrl: null,
        languageCode: 'ru',
        phone: null,
        sidePreference: null,
      },
      true,
    );
  });
  await page.route(ONBOARDING_ROUTE, async (route) => {
    await fulfillJson(route, 200, legacyCompletedOnboarding(), true);
  });
}

async function answerRemainingQuestions(page) {
  await page.getByLabel('Стабильно играю в спокойном темпе').check();
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByLabel('Возвращаю простые мячи после стекла').check();
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByLabel('Стабильно выполняю базовые действия').check();
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByLabel('Регулярные любительские матчи').check();
}

test.describe('legacy initial-level reassessment UI', () => {
  test('completes five in-memory questions through the existing session and enters the app', async ({
    page,
  }) => {
    let completionContract = null;
    let privateConsoleLeak = false;
    page.on('console', (message) => {
      const text = message.text();
      if (
        text.includes(SYNTHETIC_CREDENTIAL) ||
        text.includes(SYNTHETIC_INIT_DATA)
      ) {
        privateConsoleLeak = true;
      }
    });
    await page.setViewportSize({ width: 375, height: 667 });
    await prepareBrowser(page);
    await page.route(REASSESSMENT_ROUTE, async (route) => {
      await fulfillJson(route, 200, requiredReassessment(), true);
    });
    await page.route(REASSESSMENT_COMPLETE_ROUTE, async (route) => {
      const request = route.request();
      completionContract = {
        body: request.postDataJSON(),
        bearerMatches:
          request.headers().authorization === `Bearer ${SYNTHETIC_CREDENTIAL}`,
      };
      await fulfillJson(route, 200, completedReassessment('C+'), true);
    });

    await page.goto('/');
    const gate = page.getByTestId('initial-level-reassessment-gate');
    await expect(gate).toBeVisible();
    await expect(page.getByText('Вопрос 1 из 5')).toBeVisible();
    expect(
      await gate.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    const optionHeight = await page
      .getByLabel('1–10 матчей')
      .locator('..')
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(optionHeight).toBeGreaterThanOrEqual(48);

    await page.getByLabel('1–10 матчей').check();
    await page.getByRole('button', { name: 'Далее' }).click();
    await page.getByLabel('Стабильно играю в спокойном темпе').check();
    await page.getByRole('button', { name: 'Назад' }).click();
    await expect(page.getByLabel('1–10 матчей')).toBeChecked();
    await page.getByRole('button', { name: 'Далее' }).click();
    await answerRemainingQuestions(page);
    await page.getByRole('button', { name: 'Узнать уровень' }).click();

    await expect(
      page.getByTestId('initial-level-reassessment-result-gate'),
    ).toContainText('Ваш начальный уровень: C+');
    expect(completionContract).toEqual({
      body: {
        source: {
          flowVersion: 'tma_v1',
          surveyVersion: 'initial_level_v1',
          revision: 4,
        },
        survey: {
          version: 'initial_level_v2',
          answers: {
            match_count: 'one_to_ten',
            rally_stability: 'steady_slow',
            glass_play: 'basic_returns',
            serve_return_net: 'stable_basics',
            match_experience_year: 'regular_social',
          },
        },
      },
      bearerMatches: true,
    });
    await page.getByRole('button', { name: 'Перейти в приложение' }).click();
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await expect(page.getByTestId('home-player-level-value')).toHaveText(
      '3.50 · C+',
    );
    const persistenceLeak = await page.evaluate(
      (privateValues) => {
        const persistedValues = [];
        for (let index = 0; index < localStorage.length; index += 1) {
          persistedValues.push(localStorage.getItem(localStorage.key(index)));
        }
        for (let index = 0; index < sessionStorage.length; index += 1) {
          persistedValues.push(
            sessionStorage.getItem(sessionStorage.key(index)),
          );
        }
        return persistedValues
          .filter((value) => typeof value === 'string')
          .some((value) =>
            privateValues.some((privateValue) => value.includes(privateValue)),
          );
      },
      [
        SYNTHETIC_CREDENTIAL,
        'one_to_ten',
        'steady_slow',
        'basic_returns',
        'stable_basics',
        'regular_social',
      ],
    );
    expect(persistenceLeak).toBe(false);
    expect(privateConsoleLeak).toBe(false);
  });

  test('uses completed server state on relogin without repeating the questions', async ({
    page,
  }) => {
    let reads = 0;
    await prepareBrowser(page);
    await page.route(REASSESSMENT_ROUTE, async (route) => {
      reads += 1;
      await fulfillJson(route, 200, completedReassessment('D+'), true);
    });

    await page.goto('/');
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await expect(page.getByTestId('home-player-level-value')).toHaveText(
      '2.00 · D+',
    );
    await expect(
      page.getByTestId('initial-level-reassessment-gate'),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await expect(
      page.getByTestId('initial-level-reassessment-gate'),
    ).toHaveCount(0);
    expect(reads).toBe(2);
  });

  test('opens the app immediately for not_eligible', async ({ page }) => {
    await prepareBrowser(page);
    await page.route(REASSESSMENT_ROUTE, async (route) => {
      await fulfillJson(route, 200, { status: 'not_eligible' }, true);
    });

    await page.goto('/');
    await expect(page.locator('.bottom-nav')).toBeVisible();
    await expect(
      page.getByTestId('initial-level-reassessment-gate'),
    ).toHaveCount(0);
  });

  test('reconciles a conflicting completion to the immutable server label', async ({
    page,
  }) => {
    let reads = 0;
    await prepareBrowser(page);
    await page.route(REASSESSMENT_ROUTE, async (route) => {
      reads += 1;
      await fulfillJson(
        route,
        200,
        reads === 1 ? requiredReassessment() : completedReassessment('B'),
        true,
      );
    });
    await page.route(REASSESSMENT_COMPLETE_ROUTE, async (route) => {
      await fulfillJson(
        route,
        409,
        {
          statusCode: 409,
          code: 'initial_level_reassessment_conflict',
          message: 'Synthetic conflict',
        },
        true,
      );
    });

    await page.goto('/');
    await page.getByLabel('1–10 матчей').check();
    await page.getByRole('button', { name: 'Далее' }).click();
    await answerRemainingQuestions(page);
    await page.getByRole('button', { name: 'Узнать уровень' }).click();
    await expect(
      page.getByTestId('initial-level-reassessment-result-gate'),
    ).toContainText('Ваш начальный уровень: B');
    expect(reads).toBe(2);
  });

  test('fails closed on malformed data and recovers through the read action', async ({
    page,
  }) => {
    let reads = 0;
    await prepareBrowser(page);
    await page.route(REASSESSMENT_ROUTE, async (route) => {
      reads += 1;
      await fulfillJson(
        route,
        200,
        reads === 1
          ? { ...completedReassessment('D+'), initialLevelScore: 5 }
          : { status: 'not_eligible' },
        true,
      );
    });

    await page.goto('/');
    const loadGate = page.getByTestId('initial-level-reassessment-load-gate');
    await expect(loadGate).toHaveAttribute('data-state', 'error');
    await expect(page.locator('.bottom-nav')).toHaveCount(0);
    await page.getByRole('button', { name: 'Попробовать снова' }).click();
    await expect(page.locator('.bottom-nav')).toBeVisible();
    expect(reads).toBe(2);
  });

  test('clears the private session boundary after unauthorized read', async ({
    page,
  }) => {
    let reads = 0;
    await prepareBrowser(page);
    await page.route(REASSESSMENT_ROUTE, async (route) => {
      reads += 1;
      await fulfillJson(
        route,
        401,
        {
          statusCode: 401,
          code: 'session_invalid',
          message: 'Synthetic invalid session',
        },
        true,
      );
    });

    await page.goto('/');
    await expect.poll(() => reads).toBe(1);
    await expect(page.locator('.bottom-nav')).toHaveCount(0);
    await expect(page.getByTestId('backend-own-profile-gate')).toHaveAttribute(
      'data-state',
      'loading',
    );
  });
});

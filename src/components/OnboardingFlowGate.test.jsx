// @vitest-environment jsdom

import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OnboardingFlowGate, { LegalReconsentGate } from './OnboardingFlowGate';
import { readOnboardingLegalConfig } from '../lib/playerOnboardingUiPolicy';

const LEGAL_CONFIG = readOnboardingLegalConfig({
  VITE_ONBOARDING_LEGAL_PUBLISHED: 'true',
  VITE_ONBOARDING_LEGAL_POLICY_ALIGNED: 'true',
  VITE_ONBOARDING_TERMS_URL:
    'https://legal.example.test/terms/terms-2026-08-26/',
  VITE_ONBOARDING_TERMS_VERSION: 'terms-2026-08-26',
  VITE_ONBOARDING_PRIVACY_URL:
    'https://legal.example.test/privacy/privacy-2026-08-26/',
  VITE_ONBOARDING_PRIVACY_VERSION: 'privacy-2026-08-26',
  VITE_ONBOARDING_CANCELLATION_URL:
    'https://legal.example.test/cancellation/cancellation-2026-08-26/',
  VITE_ONBOARDING_CANCELLATION_VERSION: 'cancellation-2026-08-26',
  VITE_ONBOARDING_PERSONAL_DATA_CONSENT_URL:
    'https://legal.example.test/personal-data-consent/personal-data-consent-2026-08-26/',
  VITE_ONBOARDING_PERSONAL_DATA_CONSENT_VERSION:
    'personal-data-consent-2026-08-26',
});

const TEST_ONLY_LEGAL_CONFIG = readOnboardingLegalConfig({
  VITE_ONBOARDING_LEGAL_PUBLISHED: 'true',
  VITE_ONBOARDING_LEGAL_POLICY_ALIGNED: 'true',
  VITE_ONBOARDING_LEGAL_TEST_ONLY: 'true',
  VITE_ONBOARDING_TERMS_URL:
    'https://test-app.prostopdl.ru/legal/test-only/terms-test-2026-08-23-v1/',
  VITE_ONBOARDING_TERMS_VERSION: 'terms-test-2026-08-23-v1',
  VITE_ONBOARDING_PRIVACY_URL:
    'https://test-app.prostopdl.ru/legal/test-only/privacy-test-2026-08-23-v1/',
  VITE_ONBOARDING_PRIVACY_VERSION: 'privacy-test-2026-08-23-v1',
  VITE_ONBOARDING_CANCELLATION_URL:
    'https://test-app.prostopdl.ru/legal/test-only/cancellation-test-2026-08-23-v1/',
  VITE_ONBOARDING_CANCELLATION_VERSION: 'cancellation-test-2026-08-23-v1',
  VITE_ONBOARDING_PERSONAL_DATA_CONSENT_URL:
    'https://test-app.prostopdl.ru/legal/test-only/personal-data-consent-test-2026-08-23-v1/',
  VITE_ONBOARDING_PERSONAL_DATA_CONSENT_VERSION:
    'personal-data-consent-test-2026-08-23-v1',
});

const CONSENTS = Object.freeze([
  Object.freeze({
    kind: 'cancellation',
    documentVersion: 'cancellation-2026-08-26',
  }),
  Object.freeze({
    kind: 'personal_data_processing',
    documentVersion: 'personal-data-consent-2026-08-26',
  }),
  Object.freeze({ kind: 'terms', documentVersion: 'terms-2026-08-26' }),
]);

const INITIAL_LEVEL_V2_ANSWERS = Object.freeze({
  match_count: 'one_to_ten',
  rally_stability: 'steady_slow',
  glass_play: 'basic_returns',
  serve_return_net: 'stable_basics',
  match_experience_year: 'regular_social',
});

function onboardingState(overrides = {}) {
  return Object.freeze({
    status: 'required',
    flowVersion: null,
    currentStep: 'profile',
    surveyVersion: null,
    revision: null,
    profile: Object.freeze({ firstName: 'Synthetic', lastName: null }),
    contacts: Object.freeze({
      phone: null,
      normalizedEmail: null,
      assurance: 'declared',
    }),
    consents: Object.freeze([]),
    surveyAnswers: Object.freeze({}),
    ...overrides,
  });
}

function inProgressState(currentStep, revision, overrides = {}) {
  return onboardingState({
    status: 'in_progress',
    flowVersion: 'tma_v1',
    currentStep,
    surveyVersion: 'initial_level_v2',
    revision,
    profile: Object.freeze({ firstName: 'Анна', lastName: 'Петрова' }),
    contacts: Object.freeze({
      phone: '+79991234567',
      normalizedEmail: 'player@example.test',
      assurance: 'declared',
    }),
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OnboardingFlowGate', () => {
  it('requires only the stale consent group and preserves the current group', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn().mockResolvedValue({
      outcome: 'accepted',
      onboarding: inProgressState('completed', 5, {
        status: 'completed',
        consents: CONSENTS,
        surveyAnswers: INITIAL_LEVEL_V2_ANSWERS,
        initialLevelLabel: 'C',
      }),
    });
    const onAccepted = vi.fn();
    render(
      <LegalReconsentGate
        onboarding={inProgressState('completed', 5, {
          status: 'completed',
          consents: [
            { kind: 'terms', documentVersion: 'terms-old' },
            { kind: 'cancellation', documentVersion: 'cancellation-old' },
            {
              kind: 'personal_data_processing',
              documentVersion: 'personal-data-consent-2026-08-26',
            },
            { kind: 'privacy', documentVersion: 'privacy-old' },
          ],
          surveyAnswers: INITIAL_LEVEL_V2_ANSWERS,
          initialLevelLabel: 'C',
        })}
        legalConfig={LEGAL_CONFIG}
        onAccept={onAccept}
        onAccepted={onAccepted}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(true);
    expect(checkboxes[1].disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Продолжить' }).disabled).toBe(
      true,
    );
    await user.click(checkboxes[0]);
    await user.click(screen.getByRole('button', { name: 'Продолжить' }));

    expect(onAccept).toHaveBeenCalledWith({ consents: CONSENTS });
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('link', { name: 'Политика конфиденциальности' }),
    ).toBeTruthy();
  });

  it('labels the temporary test-only documents before any acceptance control', () => {
    render(
      <OnboardingFlowGate
        onboarding={inProgressState('consents', 2)}
        legalConfig={TEST_ONLY_LEGAL_CONFIG}
        onReload={vi.fn()}
        onSaveProfile={vi.fn()}
        onAdvance={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('complementary', {
        name: 'Временные документы тестового контура',
      }).textContent,
    ).toContain('не публикация для production');
    expect(
      screen
        .getByRole('link', { name: 'Условия использования' })
        .getAttribute('href'),
    ).toBe(
      'https://test-app.prostopdl.ru/legal/test-only/terms-test-2026-08-23-v1/',
    );
    expect(screen.getByTestId('onboarding-profile-gate')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-consents-gate')).toBeNull();
  });

  it('runs first-run profile, published consents, survey and completion without persisting PII', async () => {
    const user = userEvent.setup();
    const saveCalls = [];
    const advanceCalls = [];
    const completionCalls = [];
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    function Harness() {
      const [onboarding, setOnboarding] = useState(onboardingState());
      if (onboarding.status === 'completed') {
        return <main data-testid="authenticated-app">Приложение</main>;
      }
      return (
        <OnboardingFlowGate
          onboarding={onboarding}
          legalConfig={LEGAL_CONFIG}
          onReload={vi.fn()}
          onSaveProfile={async (draft) => {
            saveCalls.push(draft);
            const next = inProgressState('profile', 1);
            setOnboarding(next);
            return { outcome: 'saved', onboarding: next };
          }}
          onAdvance={async (progress) => {
            advanceCalls.push(progress);
            const next =
              progress.nextStep === 'consents'
                ? inProgressState('consents', 2)
                : inProgressState('level_survey', 3, {
                    consents: CONSENTS,
                  });
            setOnboarding(next);
            return { outcome: 'advanced', onboarding: next };
          }}
          onComplete={async (completion) => {
            completionCalls.push(completion);
            const next = inProgressState('completed', 4, {
              status: 'completed',
              consents: CONSENTS,
              surveyAnswers: INITIAL_LEVEL_V2_ANSWERS,
              initialLevelLabel: 'C',
            });
            return { outcome: 'completed', onboarding: next };
          }}
          onEnterApp={setOnboarding}
        />
      );
    }

    render(<Harness />);
    await user.clear(screen.getByLabelText('Имя *'));
    await user.type(screen.getByLabelText('Имя *'), '  Анна  ');
    await user.type(screen.getByLabelText('Фамилия'), '  Петрова  ');
    await user.type(screen.getByLabelText('Телефон *'), '+7 999 123-45-67');
    await user.type(screen.getByLabelText('Email *'), ' PLAYER@EXAMPLE.TEST ');
    const continueButton = screen.getByRole('button', { name: 'Продолжить' });
    expect(continueButton.disabled).toBe(true);
    for (const checkbox of screen.getAllByRole('checkbox')) {
      await user.click(checkbox);
    }
    expect(continueButton.disabled).toBe(false);
    await user.click(continueButton);

    await screen.findByTestId('onboarding-level-survey-gate');
    expect(saveCalls).toEqual([
      {
        expectedRevision: null,
        profile: { firstName: 'Анна', lastName: 'Петрова' },
        contacts: {
          phone: '+79991234567',
          email: 'player@example.test',
        },
      },
    ]);
    expect(advanceCalls[0]).toEqual({
      expectedRevision: 1,
      flowVersion: 'tma_v1',
      nextStep: 'consents',
    });
    expect(advanceCalls[1]).toEqual({
      expectedRevision: 2,
      flowVersion: 'tma_v1',
      nextStep: 'level_survey',
      consents: CONSENTS,
    });
    const surveyGroup = screen.getByRole('group', {
      name: /Сколько матчей в падел вы сыграли/u,
    });
    expect(surveyGroup.getAttribute('aria-required')).toBe('true');
    expect(screen.getAllByRole('radio').every((radio) => radio.required)).toBe(
      true,
    );
    expect(screen.getByText('Вопрос 1 из 5')).toBeTruthy();
    await user.click(screen.getByLabelText('1–10 матчей'));
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(
      screen.getByLabelText('Стабильно играю в спокойном темпе'),
    );
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(
      screen.getByLabelText('Возвращаю простые мячи после стекла'),
    );
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(
      screen.getByLabelText('Стабильно выполняю базовые действия'),
    );
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(screen.getByLabelText('Регулярные любительские матчи'));
    await user.click(screen.getByRole('button', { name: 'Узнать уровень' }));

    const result = await screen.findByTestId('onboarding-initial-level-result');
    expect(result.textContent).toContain('Ваш начальный уровень: C');
    expect(result.textContent).not.toMatch(/балл|формул|огранич/u);
    expect(completionCalls).toEqual([
      {
        expectedRevision: 3,
        flowVersion: 'tma_v1',
        consents: CONSENTS,
        survey: {
          version: 'initial_level_v2',
          answers: INITIAL_LEVEL_V2_ANSWERS,
        },
      },
    ]);
    await user.click(
      screen.getByRole('button', { name: 'Перейти в приложение' }),
    );
    await screen.findByTestId('authenticated-app');
    expect(storageWrite).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('resumes the legacy contacts step without skipping either progress transition', async () => {
    const user = userEvent.setup();
    const saved = inProgressState('contacts', 5);
    const consentStep = inProgressState('consents', 6);
    const surveyStep = inProgressState('level_survey', 7, {
      consents: CONSENTS,
    });
    const onSaveProfile = vi.fn().mockResolvedValue({
      outcome: 'saved',
      onboarding: saved,
    });
    const onAdvance = vi
      .fn()
      .mockResolvedValueOnce({ outcome: 'advanced', onboarding: consentStep })
      .mockResolvedValueOnce({ outcome: 'advanced', onboarding: surveyStep });

    render(
      <OnboardingFlowGate
        onboarding={inProgressState('contacts', 4)}
        legalConfig={LEGAL_CONFIG}
        onReload={vi.fn()}
        onSaveProfile={onSaveProfile}
        onAdvance={onAdvance}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByTestId('onboarding-profile-gate')).toBeTruthy();
    expect(screen.getByLabelText('Email *').value).toBe('player@example.test');
    for (const checkbox of screen.getAllByRole('checkbox')) {
      await user.click(checkbox);
    }
    await user.click(screen.getByRole('button', { name: 'Продолжить' }));

    await waitFor(() => expect(onAdvance).toHaveBeenCalledTimes(2));
    expect(onSaveProfile.mock.calls[0][0].expectedRevision).toBe(4);
    expect(onAdvance.mock.calls).toEqual([
      [
        {
          expectedRevision: 5,
          flowVersion: 'tma_v1',
          nextStep: 'consents',
        },
      ],
      [
        {
          expectedRevision: 6,
          flowVersion: 'tma_v1',
          nextStep: 'level_survey',
          consents: CONSENTS,
        },
      ],
    ]);
  });

  it('keeps profile and legal readiness on one fail-closed screen while documents are unpublished', () => {
    const onSaveProfile = vi.fn();
    const onAdvance = vi.fn();
    const onComplete = vi.fn();
    render(
      <OnboardingFlowGate
        onboarding={inProgressState('consents', 2)}
        legalConfig={{
          status: 'unavailable',
          reason: 'not_published',
          documents: [],
        }}
        onReload={vi.fn()}
        onSaveProfile={onSaveProfile}
        onAdvance={onAdvance}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByTestId('onboarding-profile-gate')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-consents-gate')).toBeNull();
    expect(screen.getByLabelText('Имя *').value).toBe('Анна');
    expect(screen.getByText(/Черновики не используются/u)).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Продолжить' }).disabled).toBe(
      true,
    );
    expect(onSaveProfile).not.toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('keeps continue disabled until profile fields and both confirmations are valid', async () => {
    const user = userEvent.setup();
    const onSaveProfile = vi.fn();
    const onAdvance = vi.fn();
    render(
      <OnboardingFlowGate
        onboarding={onboardingState()}
        legalConfig={LEGAL_CONFIG}
        onReload={vi.fn()}
        onSaveProfile={onSaveProfile}
        onAdvance={onAdvance}
        onComplete={vi.fn()}
      />,
    );

    const continueButton = screen.getByRole('button', { name: 'Продолжить' });
    await user.type(screen.getByLabelText('Телефон *'), '89991234567');
    await user.type(screen.getByLabelText('Email *'), 'player@example.test');
    for (const checkbox of screen.getAllByRole('checkbox')) {
      await user.click(checkbox);
    }
    expect(continueButton.disabled).toBe(true);

    await user.tab();
    expect(screen.getByText(/международном формате/u)).toBeTruthy();
    await user.clear(screen.getByLabelText('Телефон *'));
    await user.type(screen.getByLabelText('Телефон *'), '+79991234567');
    expect(continueButton.disabled).toBe(false);
    expect(onSaveProfile).not.toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('locks profile and consent controls for the complete one-click sequence', async () => {
    const user = userEvent.setup();
    let resolveSave;
    const onSaveProfile = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(
      <OnboardingFlowGate
        onboarding={inProgressState('profile', 4)}
        legalConfig={LEGAL_CONFIG}
        onReload={vi.fn()}
        onSaveProfile={onSaveProfile}
        onAdvance={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    for (const checkbox of screen.getAllByRole('checkbox')) {
      await user.click(checkbox);
    }
    const continueButton = screen.getByRole('button', { name: 'Продолжить' });
    await user.click(continueButton);

    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledTimes(1));
    expect(
      screen.getAllByRole('textbox').every((input) => input.disabled),
    ).toBe(true);
    expect(
      screen
        .getAllByRole('checkbox')
        .every((checkbox) => checkbox.matches(':disabled')),
    ).toBe(true);
    expect(continueButton.getAttribute('aria-busy')).toBe('true');
    expect(screen.getAllByRole('link')).toHaveLength(4);

    resolveSave({ outcome: 'reconciled' });
    await waitFor(() => expect(continueButton.disabled).toBe(false));
  });

  it('reports a saved profile truthfully when the following progress call fails', async () => {
    const user = userEvent.setup();
    const saved = inProgressState('profile', 1);
    const onAdvance = vi.fn().mockResolvedValue({
      outcome: 'rejected',
      reason: 'temporary_unavailable',
    });
    render(
      <OnboardingFlowGate
        onboarding={onboardingState()}
        legalConfig={LEGAL_CONFIG}
        onReload={vi.fn()}
        onSaveProfile={vi.fn().mockResolvedValue({
          outcome: 'saved',
          onboarding: saved,
        })}
        onAdvance={onAdvance}
        onComplete={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText('Телефон *'), '+79991234567');
    await user.type(screen.getByLabelText('Email *'), 'synthetic@example.test');
    for (const checkbox of screen.getAllByRole('checkbox')) {
      await user.click(checkbox);
    }
    await user.click(screen.getByRole('button', { name: 'Продолжить' }));

    await waitFor(() => expect(onAdvance).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert').textContent).toContain(
      'Данные сохранены, но перейти дальше не удалось',
    );
    expect(
      screen.getByRole('button', { name: 'Обновить данные' }),
    ).toBeTruthy();
  });

  it('resumes consents on the combined screen and stops after stale reconciliation', async () => {
    const user = userEvent.setup();
    const saved = inProgressState('consents', 9);
    const onSaveProfile = vi.fn().mockResolvedValue({
      outcome: 'saved',
      onboarding: saved,
    });
    const onAdvance = vi.fn().mockResolvedValue({ outcome: 'reconciled' });
    render(
      <OnboardingFlowGate
        onboarding={inProgressState('consents', 8)}
        legalConfig={LEGAL_CONFIG}
        onReload={vi.fn()}
        onSaveProfile={onSaveProfile}
        onAdvance={onAdvance}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByTestId('onboarding-profile-gate')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-consents-gate')).toBeNull();
    expect(screen.getByLabelText('Телефон *').value).toBe('+79991234567');
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((checkbox) => checkbox.required)).toBe(true);
    expect(
      screen.getByRole('checkbox', {
        name: /Условия использования версии terms-2026-08-26 и Правила отмены версии cancellation-2026-08-26/u,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('checkbox', {
        name: /согласие на обработку персональных данных версии personal-data-consent-2026-08-26/u,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Политика конфиденциальности' }),
    ).toBeTruthy();
    const continueButton = screen.getByRole('button', { name: 'Продолжить' });
    expect(continueButton.disabled).toBe(true);
    await user.click(continueButton);
    expect(onSaveProfile).not.toHaveBeenCalled();
    expect(onAdvance).not.toHaveBeenCalled();

    for (const checkbox of checkboxes) {
      await user.click(checkbox);
    }
    expect(continueButton.disabled).toBe(false);
    await user.click(continueButton);
    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onAdvance).toHaveBeenCalledTimes(1));
    expect(onSaveProfile.mock.calls[0][0].expectedRevision).toBe(8);
    expect(onAdvance).toHaveBeenCalledWith({
      expectedRevision: 9,
      flowVersion: 'tma_v1',
      nextStep: 'level_survey',
      consents: CONSENTS,
    });
    expect(screen.getByRole('status').textContent).toContain(
      'более новая версия',
    );
  });

  it('resumes five-question progress, supports back and fails closed for a different completion', async () => {
    const user = userEvent.setup();
    let resolveCompletion;
    const onComplete = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCompletion = resolve;
        }),
    );
    const { rerender } = render(
      <OnboardingFlowGate
        onboarding={inProgressState('level_survey', 3, {
          consents: CONSENTS,
          surveyAnswers: Object.freeze({
            match_count: 'one_to_ten',
            rally_stability: 'steady_slow',
          }),
        })}
        legalConfig={LEGAL_CONFIG}
        onReload={vi.fn()}
        onSaveProfile={vi.fn()}
        onAdvance={vi.fn()}
        onComplete={onComplete}
        onEnterApp={vi.fn()}
      />,
    );

    expect(screen.getByTestId('onboarding-level-survey-gate')).toBeTruthy();
    expect(screen.getByText('Вопрос 3 из 5')).toBeTruthy();
    expect(
      screen.getByRole('group', {
        name: /Как вы играете мяч после отскока от стекла/u,
      }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByText('Вопрос 2 из 5')).toBeTruthy();
    expect(
      screen.getByLabelText('Стабильно играю в спокойном темпе').checked,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    const surveyAlert = screen.getByRole('alert');
    const surveyGroup = screen.getByRole('group', {
      name: /Как вы играете мяч после отскока от стекла/u,
    });
    expect(surveyGroup.getAttribute('aria-invalid')).toBe('true');
    expect(surveyGroup.getAttribute('aria-describedby')).toBe(surveyAlert.id);
    expect(onComplete).not.toHaveBeenCalled();
    await user.click(
      screen.getByLabelText('Возвращаю простые мячи после стекла'),
    );
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(
      screen.getByLabelText('Стабильно выполняю базовые действия'),
    );
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(screen.getByLabelText('Регулярные любительские матчи'));
    await user.click(screen.getByRole('button', { name: 'Узнать уровень' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledWith({
      expectedRevision: 3,
      flowVersion: 'tma_v1',
      consents: CONSENTS,
      survey: {
        version: 'initial_level_v2',
        answers: INITIAL_LEVEL_V2_ANSWERS,
      },
    });
    expect(
      screen.getAllByRole('radio').every((radio) => radio.matches(':disabled')),
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: 'Завершаем…' })
        .getAttribute('aria-busy'),
    ).toBe('true');
    resolveCompletion({ outcome: 'rejected', reason: 'conflict' });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'отличается от уже обработанного',
      ),
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'отличается от уже обработанного',
    );

    const changedLegalConfig = readOnboardingLegalConfig({
      VITE_ONBOARDING_LEGAL_PUBLISHED: 'true',
      VITE_ONBOARDING_LEGAL_POLICY_ALIGNED: 'true',
      VITE_ONBOARDING_TERMS_URL:
        'https://legal.example.test/terms/terms-new/',
      VITE_ONBOARDING_TERMS_VERSION: 'terms-new',
      VITE_ONBOARDING_PRIVACY_URL:
        'https://legal.example.test/privacy/privacy-2026-08-26/',
      VITE_ONBOARDING_PRIVACY_VERSION: 'privacy-2026-08-26',
      VITE_ONBOARDING_CANCELLATION_URL:
        'https://legal.example.test/cancellation/cancellation-2026-08-26/',
      VITE_ONBOARDING_CANCELLATION_VERSION: 'cancellation-2026-08-26',
      VITE_ONBOARDING_PERSONAL_DATA_CONSENT_URL:
        'https://legal.example.test/personal-data-consent/personal-data-consent-2026-08-26/',
      VITE_ONBOARDING_PERSONAL_DATA_CONSENT_VERSION:
        'personal-data-consent-2026-08-26',
    });
    rerender(
      <OnboardingFlowGate
        onboarding={inProgressState('level_survey', 3, {
          consents: CONSENTS,
        })}
        legalConfig={changedLegalConfig}
        onReload={vi.fn()}
        onSaveProfile={vi.fn()}
        onAdvance={vi.fn()}
        onComplete={onComplete}
        onEnterApp={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId('onboarding-completion-unavailable-gate'),
    ).toBeTruthy();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

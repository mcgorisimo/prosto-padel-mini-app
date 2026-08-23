// @vitest-environment jsdom

import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OnboardingFlowGate from './OnboardingFlowGate';
import { readOnboardingLegalConfig } from '../lib/playerOnboardingUiPolicy';

const LEGAL_CONFIG = readOnboardingLegalConfig({
  VITE_ONBOARDING_LEGAL_PUBLISHED: 'true',
  VITE_ONBOARDING_LEGAL_POLICY_ALIGNED: 'true',
  VITE_ONBOARDING_TERMS_URL: 'https://legal.example.test/terms',
  VITE_ONBOARDING_TERMS_VERSION: 'terms-2026-08-26',
  VITE_ONBOARDING_PRIVACY_URL: 'https://legal.example.test/privacy',
  VITE_ONBOARDING_PRIVACY_VERSION: 'privacy-2026-08-26',
  VITE_ONBOARDING_CANCELLATION_URL: 'https://legal.example.test/cancellation',
  VITE_ONBOARDING_CANCELLATION_VERSION: 'cancellation-2026-08-26',
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
  VITE_ONBOARDING_CANCELLATION_VERSION:
    'cancellation-test-2026-08-23-v1',
});

const CONSENTS = Object.freeze([
  Object.freeze({ kind: 'terms', documentVersion: 'terms-2026-08-26' }),
  Object.freeze({ kind: 'privacy', documentVersion: 'privacy-2026-08-26' }),
  Object.freeze({
    kind: 'cancellation',
    documentVersion: 'cancellation-2026-08-26',
  }),
]);

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
    surveyVersion: 'initial_level_v1',
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
        .getByRole('link', { name: /terms-test-2026-08-23-v1/u })
        .getAttribute('href'),
    ).toBe(
      'https://test-app.prostopdl.ru/legal/test-only/terms-test-2026-08-23-v1/',
    );
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
              surveyAnswers: Object.freeze({ experience: 'beginner' }),
            });
            setOnboarding(next);
            return { outcome: 'completed', onboarding: next };
          }}
        />
      );
    }

    render(<Harness />);
    await user.clear(screen.getByLabelText('Имя *'));
    await user.type(screen.getByLabelText('Имя *'), '  Анна  ');
    await user.type(screen.getByLabelText('Фамилия'), '  Петрова  ');
    await user.type(screen.getByLabelText('Телефон *'), '+7 999 123-45-67');
    await user.type(screen.getByLabelText('Email *'), ' PLAYER@EXAMPLE.TEST ');
    await user.click(screen.getByRole('button', { name: 'Сохранить профиль' }));

    await screen.findByTestId('onboarding-consents-gate');
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

    for (const checkbox of screen.getAllByRole('checkbox')) {
      await user.click(checkbox);
    }
    await user.click(screen.getByRole('button', { name: 'Продолжить' }));

    await screen.findByTestId('onboarding-level-survey-gate');
    expect(advanceCalls[1]).toEqual({
      expectedRevision: 2,
      flowVersion: 'tma_v1',
      nextStep: 'level_survey',
      consents: CONSENTS,
    });
    const surveyGroup = screen.getByRole('group', {
      name: /Какой у вас опыт игры в падел/u,
    });
    expect(surveyGroup.getAttribute('aria-required')).toBe('true');
    expect(screen.getAllByRole('radio').every((radio) => radio.required)).toBe(
      true,
    );
    await user.click(screen.getByLabelText('Начинаю играть'));
    await user.click(
      screen.getByRole('button', { name: 'Завершить настройку' }),
    );

    await screen.findByTestId('authenticated-app');
    expect(completionCalls).toEqual([
      {
        expectedRevision: 3,
        flowVersion: 'tma_v1',
        consents: CONSENTS,
        survey: {
          version: 'initial_level_v1',
          answers: { experience: 'beginner' },
        },
      },
    ]);
    expect(storageWrite).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('resumes consents and refuses all legal or completion writes while documents are unpublished', () => {
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
        onSaveProfile={vi.fn()}
        onAdvance={onAdvance}
        onComplete={onComplete}
      />,
    );

    expect(
      screen.getByTestId('onboarding-legal-unavailable-gate'),
    ).toBeTruthy();
    expect(screen.getByText(/Черновики не используются/u)).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(onAdvance).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
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
    await user.click(screen.getByRole('button', { name: 'Сохранить профиль' }));

    await waitFor(() => expect(onAdvance).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert').textContent).toContain(
      'Профиль сохранён, но перейти дальше не удалось',
    );
    expect(
      screen.getByRole('button', { name: 'Обновить данные' }),
    ).toBeTruthy();
  });

  it('requires all documents and reports stale reconciliation without replaying progress', async () => {
    const user = userEvent.setup();
    const onAdvance = vi.fn().mockResolvedValue({ outcome: 'reconciled' });
    render(
      <OnboardingFlowGate
        onboarding={inProgressState('consents', 8)}
        legalConfig={LEGAL_CONFIG}
        onReload={vi.fn()}
        onSaveProfile={vi.fn()}
        onAdvance={onAdvance}
        onComplete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Продолжить' }));
    const validationAlert = screen.getByRole('alert');
    expect(validationAlert.textContent).toContain('Подтвердите ознакомление');
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.every((checkbox) => checkbox.required)).toBe(true);
    expect(checkboxes[0].getAttribute('aria-invalid')).toBe('true');
    expect(checkboxes[0].getAttribute('aria-describedby')).toBe(
      validationAlert.id,
    );
    expect(
      screen.getByRole('checkbox', {
        name: /Условия использования, версия terms-2026-08-26/u,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('checkbox', {
        name: /Политика конфиденциальности, версия privacy-2026-08-26/u,
      }),
    ).toBeTruthy();
    expect(onAdvance).not.toHaveBeenCalled();

    for (const checkbox of checkboxes) {
      await user.click(checkbox);
    }
    await user.click(screen.getByRole('button', { name: 'Продолжить' }));
    await waitFor(() => expect(onAdvance).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status').textContent).toContain(
      'более новая версия',
    );
  });

  it('resumes level survey and fails closed for changed legal versions or a different completion', async () => {
    const user = userEvent.setup();
    const onComplete = vi
      .fn()
      .mockResolvedValue({ outcome: 'rejected', reason: 'conflict' });
    const { rerender } = render(
      <OnboardingFlowGate
        onboarding={inProgressState('level_survey', 3, {
          consents: CONSENTS,
        })}
        legalConfig={LEGAL_CONFIG}
        onReload={vi.fn()}
        onSaveProfile={vi.fn()}
        onAdvance={vi.fn()}
        onComplete={onComplete}
      />,
    );

    expect(screen.getByTestId('onboarding-level-survey-gate')).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Завершить настройку' }),
    );
    const surveyAlert = screen.getByRole('alert');
    const surveyGroup = screen.getByRole('group', {
      name: /Какой у вас опыт игры в падел/u,
    });
    expect(surveyGroup.getAttribute('aria-invalid')).toBe('true');
    expect(surveyGroup.getAttribute('aria-describedby')).toBe(surveyAlert.id);
    expect(onComplete).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText('Играю регулярно'));
    await user.click(
      screen.getByRole('button', { name: 'Завершить настройку' }),
    );
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert').textContent).toContain(
      'отличается от уже обработанного',
    );

    const changedLegalConfig = readOnboardingLegalConfig({
      VITE_ONBOARDING_LEGAL_PUBLISHED: 'true',
      VITE_ONBOARDING_LEGAL_POLICY_ALIGNED: 'true',
      VITE_ONBOARDING_TERMS_URL: 'https://legal.example.test/terms',
      VITE_ONBOARDING_TERMS_VERSION: 'terms-new',
      VITE_ONBOARDING_PRIVACY_URL: 'https://legal.example.test/privacy',
      VITE_ONBOARDING_PRIVACY_VERSION: 'privacy-2026-08-26',
      VITE_ONBOARDING_CANCELLATION_URL:
        'https://legal.example.test/cancellation',
      VITE_ONBOARDING_CANCELLATION_VERSION: 'cancellation-2026-08-26',
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
      />,
    );
    expect(
      screen.getByTestId('onboarding-completion-unavailable-gate'),
    ).toBeTruthy();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

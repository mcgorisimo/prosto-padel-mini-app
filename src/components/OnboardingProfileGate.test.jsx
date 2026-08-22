// @vitest-environment jsdom

import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OnboardingProfileGate, {
  buildOnboardingProfileDraft,
} from './OnboardingProfileGate';

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OnboardingProfileGate', () => {
  it('builds the first-run PATCH contract with canonical contacts and no persistence or logging', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue({ outcome: 'saved' });
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    render(
      <OnboardingProfileGate
        onboarding={onboardingState()}
        onReload={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText('Имя *').required).toBe(true);
    expect(screen.getByLabelText('Телефон *').required).toBe(true);
    expect(screen.getByLabelText('Email *').required).toBe(true);

    await user.clear(screen.getByLabelText('Имя *'));
    await user.type(screen.getByLabelText('Имя *'), '  Анна  ');
    await user.type(screen.getByLabelText('Фамилия'), '  Петрова  ');
    await user.type(screen.getByLabelText('Телефон *'), '+7 (999) 123-45-67');
    await user.type(screen.getByLabelText('Email *'), '  PLAYER@EXAMPLE.COM  ');
    await user.click(screen.getByRole('button', { name: 'Сохранить профиль' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      expectedRevision: null,
      profile: { firstName: 'Анна', lastName: 'Петрова' },
      contacts: {
        phone: '+79991234567',
        email: 'player@example.com',
      },
    });
    expect(screen.getByRole('status').textContent).toContain(
      'Профиль сохранён.',
    );
    expect(storageWrite).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('resumes the server draft and submits its optimistic revision', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue({ outcome: 'saved' });
    const resume = onboardingState({
      status: 'in_progress',
      flowVersion: 'tma_v1',
      surveyVersion: 'initial_level_v1',
      revision: 7,
      profile: Object.freeze({ firstName: 'Ирина', lastName: 'Соколова' }),
      contacts: Object.freeze({
        phone: '+79990001122',
        normalizedEmail: 'irina@example.com',
        assurance: 'declared',
      }),
    });

    render(
      <OnboardingProfileGate
        onboarding={resume}
        onReload={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText('Имя *').value).toBe('Ирина');
    expect(screen.getByLabelText('Телефон *').value).toBe('+79990001122');
    expect(screen.getByLabelText('Email *').value).toBe('irina@example.com');
    await user.click(screen.getByRole('button', { name: 'Сохранить профиль' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].expectedRevision).toBe(7);
  });

  it('shows inline validation and focuses the first invalid field', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <OnboardingProfileGate
        onboarding={onboardingState()}
        onReload={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.clear(screen.getByLabelText('Имя *'));
    await user.type(screen.getByLabelText('Телефон *'), '89991234567');
    await user.type(screen.getByLabelText('Email *'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Сохранить профиль' }));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Имя *'));
    });
    expect(screen.getByText('Укажите имя.')).toBeTruthy();
    expect(
      screen.getAllByText(/международном формате/u).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Введите корректный email.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('reconciles a stale revision from GET and never replays PATCH automatically', async () => {
    const user = userEvent.setup();
    const staleServerState = onboardingState({
      status: 'in_progress',
      flowVersion: 'tma_v1',
      surveyVersion: 'initial_level_v1',
      revision: 3,
      profile: Object.freeze({ firstName: 'Мария', lastName: 'Новая' }),
      contacts: Object.freeze({
        phone: '+79995554433',
        normalizedEmail: 'new@example.com',
        assurance: 'declared',
      }),
    });
    const onSave = vi.fn();

    function Harness() {
      const [state, setState] = useState(
        onboardingState({
          status: 'in_progress',
          flowVersion: 'tma_v1',
          surveyVersion: 'initial_level_v1',
          revision: 2,
          contacts: Object.freeze({
            phone: '+79990001122',
            normalizedEmail: 'old@example.com',
            assurance: 'declared',
          }),
        }),
      );
      const save = async (draft) => {
        onSave(draft);
        setState(staleServerState);
        return { outcome: 'reconciled', onboarding: staleServerState };
      };
      return (
        <OnboardingProfileGate
          onboarding={state}
          onReload={vi.fn()}
          onSave={save}
        />
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Сохранить профиль' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Имя *').value).toBe('Мария');
    });
    expect(screen.getByLabelText('Email *').value).toBe('new@example.com');
    expect(screen.getByText(/более новая версия/u)).toBeTruthy();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('requires a read reconciliation after an unknown write outcome', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue({
      outcome: 'rejected',
      reason: 'unknown_outcome',
    });
    const onReload = vi.fn().mockResolvedValue({ outcome: 'loaded' });

    render(
      <OnboardingProfileGate
        onboarding={onboardingState()}
        onReload={onReload}
        onSave={onSave}
      />,
    );

    await user.type(screen.getByLabelText('Телефон *'), '+79991234567');
    await user.type(screen.getByLabelText('Email *'), 'player@example.com');
    await user.click(screen.getByRole('button', { name: 'Сохранить профиль' }));
    await screen.findByRole('button', { name: 'Обновить данные' });
    expect(onSave).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Обновить данные' }));
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('buildOnboardingProfileDraft', () => {
  it('does not infer a country code from a non-E.164 phone', () => {
    const result = buildOnboardingProfileDraft(
      {
        firstName: 'Игрок',
        lastName: '',
        phone: '89991234567',
        email: 'player@example.com',
      },
      null,
    );

    expect(result.draft).toBeNull();
    expect(result.errors.phone).toBeTruthy();
  });
});

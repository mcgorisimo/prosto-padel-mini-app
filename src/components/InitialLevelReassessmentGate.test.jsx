// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InitialLevelReassessmentGate from './InitialLevelReassessmentGate';

const REQUIRED = Object.freeze({
  status: 'required',
  source: Object.freeze({
    flowVersion: 'tma_v1',
    surveyVersion: 'initial_level_v1',
    revision: 4,
  }),
  surveyVersion: 'initial_level_v2',
});

const ANSWERS = Object.freeze({
  match_count: 'one_to_ten',
  rally_stability: 'steady_slow',
  glass_play: 'basic_returns',
  serve_return_net: 'stable_basics',
  match_experience_year: 'regular_social',
});

async function answerSurvey(user) {
  await user.click(screen.getByLabelText('1–10 матчей'));
  await user.click(screen.getByRole('button', { name: 'Далее' }));
  await user.click(screen.getByLabelText('Стабильно играю в спокойном темпе'));
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
}

describe('InitialLevelReassessmentGate', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('keeps five answers in memory, preserves Back state and shows only the server label', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue({
      outcome: 'completed',
      reassessment: {
        status: 'completed',
        surveyVersion: 'initial_level_v2',
        initialLevelLabel: 'C+',
      },
    });
    const onEnterApp = vi.fn();
    render(
      <InitialLevelReassessmentGate
        reassessment={REQUIRED}
        onComplete={onComplete}
        onEnterApp={onEnterApp}
        onReconcile={vi.fn()}
      />,
    );

    expect(screen.getByText('Вопрос 1 из 5')).toBeTruthy();
    await user.click(screen.getByLabelText('1–10 матчей'));
    await user.click(screen.getByRole('button', { name: 'Далее' }));
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByLabelText('1–10 матчей').checked).toBe(true);
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

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete).toHaveBeenCalledWith({
      source: REQUIRED.source,
      survey: {
        version: 'initial_level_v2',
        answers: ANSWERS,
      },
    });
    expect(
      screen.getByText('Ваш начальный уровень:', { exact: false }).textContent,
    ).toBe('Ваш начальный уровень: C+');
    expect(document.body.textContent).not.toMatch(/score|формул|ограничител/iu);
    await user.click(
      screen.getByRole('button', { name: 'Перейти в приложение' }),
    );
    expect(onEnterApp).toHaveBeenCalledWith({
      status: 'completed',
      surveyVersion: 'initial_level_v2',
      initialLevelLabel: 'C+',
    });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('reuses the exact immutable completion after a recoverable failure', async () => {
    const user = userEvent.setup();
    const onComplete = vi
      .fn()
      .mockResolvedValueOnce({ outcome: 'rejected', reason: 'internal_error' })
      .mockResolvedValueOnce({
        outcome: 'completed',
        reassessment: {
          status: 'completed',
          surveyVersion: 'initial_level_v2',
          initialLevelLabel: 'C',
        },
      });
    render(
      <InitialLevelReassessmentGate
        reassessment={REQUIRED}
        onComplete={onComplete}
        onEnterApp={vi.fn()}
        onReconcile={vi.fn()}
      />,
    );

    await answerSurvey(user);
    await user.click(screen.getByRole('button', { name: 'Узнать уровень' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Узнать уровень' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
    expect(onComplete.mock.calls[1][0]).toBe(onComplete.mock.calls[0][0]);
    expect(
      screen.getByText('Ваш начальный уровень:', { exact: false }),
    ).toBeTruthy();
  });

  it('reconciles a different completion to the immutable server result', async () => {
    const user = userEvent.setup();
    const completed = Object.freeze({
      status: 'completed',
      surveyVersion: 'initial_level_v2',
      initialLevelLabel: 'B',
    });
    const onReconcile = vi.fn().mockResolvedValue({
      outcome: 'loaded',
      reassessment: completed,
    });
    render(
      <InitialLevelReassessmentGate
        reassessment={REQUIRED}
        onComplete={vi.fn().mockResolvedValue({
          outcome: 'rejected',
          reason: 'conflict',
        })}
        onEnterApp={vi.fn()}
        onReconcile={onReconcile}
      />,
    );

    await answerSurvey(user);
    await user.click(screen.getByRole('button', { name: 'Узнать уровень' }));
    await waitFor(() => expect(onReconcile).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText('Ваш начальный уровень:', { exact: false }).textContent,
    ).toBe('Ваш начальный уровень: B');
  });

  it('keeps answers after stale-source reconciliation and adopts the new source', async () => {
    const user = userEvent.setup();
    const refreshed = Object.freeze({
      ...REQUIRED,
      source: Object.freeze({ ...REQUIRED.source, revision: 5 }),
    });
    const onComplete = vi
      .fn()
      .mockResolvedValueOnce({
        outcome: 'rejected',
        reason: 'stale_source',
      })
      .mockResolvedValueOnce({
        outcome: 'completed',
        reassessment: {
          status: 'completed',
          surveyVersion: 'initial_level_v2',
          initialLevelLabel: 'C+',
        },
      });
    render(
      <InitialLevelReassessmentGate
        reassessment={REQUIRED}
        onComplete={onComplete}
        onEnterApp={vi.fn()}
        onReconcile={vi.fn().mockResolvedValue({
          outcome: 'loaded',
          reassessment: refreshed,
        })}
      />,
    );

    await answerSurvey(user);
    await user.click(screen.getByRole('button', { name: 'Узнать уровень' }));
    await screen.findByRole('status');
    expect(screen.getByLabelText('Регулярные любительские матчи').checked).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Узнать уровень' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
    expect(onComplete.mock.calls[1][0].source.revision).toBe(5);
  });

  it('reports validation inline and does not log questionnaire data', async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    render(
      <InitialLevelReassessmentGate
        reassessment={REQUIRED}
        onComplete={vi.fn()}
        onEnterApp={vi.fn()}
        onReconcile={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Далее' }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Выберите один вариант.');
    expect(
      screen
        .getByRole('group', { name: /Сколько матчей/u })
        .getAttribute('aria-describedby'),
    ).toBe(alert.id);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleLog.mockRestore();
  });
});

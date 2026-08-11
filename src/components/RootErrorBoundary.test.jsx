// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RootErrorBoundary, {
  ROOT_ERROR_STAGE,
} from './RootErrorBoundary';

const SENSITIVE_ERROR =
  'Bearer secret-credential initData=user-phone provider-response';

function suppressExpectedReactError() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('RootErrorBoundary', () => {
  it('renders ordinary children without changing them', () => {
    render(
      <RootErrorBoundary>
        <p>Обычный экран приложения</p>
      </RootErrorBoundary>,
    );

    expect(screen.getByText('Обычный экран приложения')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a focused sanitized recovery action and reports only the stage', () => {
    suppressExpectedReactError();
    const onReport = vi.fn();
    const BrokenScreen = () => {
      throw new Error(SENSITIVE_ERROR);
    };

    render(
      <RootErrorBoundary onReport={onReport}>
        <BrokenScreen />
      </RootErrorBoundary>,
    );

    const retry = screen.getByRole('button', { name: 'Попробовать снова' });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', {
      name: 'Не удалось открыть приложение',
    })).toBeTruthy();
    expect(document.body.textContent).not.toContain(SENSITIVE_ERROR);
    expect(document.activeElement).toBe(retry);
    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledWith({ stage: ROOT_ERROR_STAGE });
    expect(JSON.stringify(onReport.mock.calls)).not.toContain(SENSITIVE_ERROR);
  });

  it('retries only after an explicit action and remounts the child subtree', async () => {
    suppressExpectedReactError();
    let shouldThrow = true;
    let mounts = 0;
    const onReport = vi.fn();
    const FlakyScreen = () => {
      mounts += 1;
      if (shouldThrow) throw new Error(SENSITIVE_ERROR);
      return <p>Экран восстановлен</p>;
    };

    render(
      <RootErrorBoundary onReport={onReport}>
        <FlakyScreen />
      </RootErrorBoundary>,
    );

    const attemptsBeforeAction = mounts;
    await Promise.resolve();
    expect(mounts).toBe(attemptsBeforeAction);
    expect(onReport).toHaveBeenCalledTimes(1);

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }));

    expect(await screen.findByText('Экран восстановлен')).toBeTruthy();
    expect(mounts).toBeGreaterThan(attemptsBeforeAction);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it('bounds repeated failures and survives a failing diagnostic reporter', async () => {
    suppressExpectedReactError();
    const onReport = vi.fn(() => {
      throw new Error('reporter failure with secret');
    });
    const AlwaysBroken = () => {
      throw new Error(SENSITIVE_ERROR);
    };

    render(
      <RootErrorBoundary onReport={onReport}>
        <AlwaysBroken />
      </RootErrorBoundary>,
    );

    expect(onReport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }));

    await waitFor(() => expect(onReport).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeTruthy();
    expect(document.body.textContent).not.toContain(SENSITIVE_ERROR);
    expect(document.body.textContent).not.toContain('reporter failure');
  });
});

// @vitest-environment jsdom

import { createPortal } from 'react-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const originalFetch = globalThis.fetch;
const originalCrypto = globalThis.crypto;
const originalLeakEnv = process.env.UNIT_TEST_LEAK;

function LeakedPortal() {
  return createPortal(
    <div role="dialog" aria-label="Намеренно оставленный диалог" />,
    document.body,
  );
}

describe.sequential('unit harness isolation probe', () => {
  it('intentionally leaves resources for the global cleanup hook', () => {
    render(<LeakedPortal />);
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('crypto', { randomUUID: () => 'leaked' });
    vi.stubEnv('UNIT_TEST_LEAK', 'leaked');
    window.localStorage.setItem('leaked', 'local');
    window.sessionStorage.setItem('leaked', 'session');

    expect(screen.getByRole('dialog', {
      name: 'Намеренно оставленный диалог',
    })).toBeTruthy();
    expect(vi.isFakeTimers()).toBe(true);
  });

  it('starts with roots, globals, timers, env and storage restored', () => {
    expect(screen.queryByRole('dialog', {
      name: 'Намеренно оставленный диалог',
    })).toBeNull();
    expect(document.body.childElementCount).toBe(0);
    expect(vi.isFakeTimers()).toBe(false);
    expect(globalThis.fetch).toBe(originalFetch);
    expect(globalThis.crypto).toBe(originalCrypto);
    expect(process.env.UNIT_TEST_LEAK).toBe(originalLeakEnv);
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
  });
});

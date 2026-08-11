// @vitest-environment jsdom

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

function PortalHarness({ onCleanup }) {
  const [open, setOpen] = useState(false);

  useEffect(() => onCleanup, [onCleanup]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Открыть
      </button>
      {open && createPortal(
        <div role="dialog" aria-label="Тестовый диалог">
          <button type="button" onClick={() => setOpen(false)}>
            Закрыть
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

describe('React unit harness', () => {
  it('renders, interacts, cleans a portal and runs effect cleanup', async () => {
    const onCleanup = vi.fn();
    const user = userEvent.setup();
    const view = render(<PortalHarness onCleanup={onCleanup} />);

    await user.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(screen.getByRole('dialog', { name: 'Тестовый диалог' }))
      .toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog', { name: 'Тестовый диалог' }))
      .toBeNull();

    view.unmount();
    expect(onCleanup).toHaveBeenCalledTimes(1);
  });
});

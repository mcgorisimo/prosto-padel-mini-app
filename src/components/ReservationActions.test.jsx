// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ReservationActions from './ReservationActions';

it('opens the linked entity during a stale read and never offers a second match', async () => {
  const onOpenMatch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const onOrganizeMatch = vi.fn();
  render(<ReservationActions reservation={{ stale: true, linkedMatchId: 'existing' }} onOpenMatch={onOpenMatch} onOrganizeMatch={onOrganizeMatch} />);
  expect(screen.queryByText('Организовать матч')).toBeNull();
  fireEvent.click(screen.getByText('Открыть матч'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByText('Открыть матч'));
  await waitFor(() => expect(onOpenMatch).toHaveBeenCalledTimes(2));
  expect(onOpenMatch.mock.calls[0][0]).toBe('existing');
  expect(onOrganizeMatch).not.toHaveBeenCalled();
});

it('invalidates a pending opening when the user leaves booking details', async () => {
  let isCurrent;
  let finish;
  const onOpenMatch = vi.fn((_match, current) => { isCurrent = current; return new Promise((resolve) => { finish = resolve; }); });
  const { unmount } = render(<ReservationActions reservation={{ linkedMatchId: 'existing' }} onOpenMatch={onOpenMatch} />);
  fireEvent.click(screen.getByText('Открыть матч'));
  expect(isCurrent()).toBe(true);
  unmount();
  expect(isCurrent()).toBe(false);
  finish();
});

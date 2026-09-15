// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminCrmBinding from './AdminCrmBinding';
const player = { id: '11111111-1111-4111-8111-111111111111' };
const draft = {
  outcome: 'preview',
  draftId: '22222222-2222-4222-8222-222222222222',
  name: 'Тест Игрок',
  phoneHint: '•••• 2233',
  expiresAt: 1900000300,
};
afterEach(cleanup);
describe('administrator manual linking', () => {
  it('normalizes email for lookup and discards attestation when it changes', async () => {
    const user = userEvent.setup();
    const actions = { previewManualCrmBinding: vi.fn().mockResolvedValue(draft) };
    render(<AdminCrmBinding player={player} actions={actions} />);
    const input = screen.getByLabelText('Email или ID клиента YCLIENTS');
    await user.type(input, ' Owner@Example.Test ');
    await user.click(screen.getByRole('button', { name: 'Проверить карточку' }));
    await screen.findByRole('checkbox');
    expect(actions.previewManualCrmBinding).toHaveBeenCalledWith(player.id, 'owner@example.test');
    expect(screen.getByRole('button', { name: 'Подтвердить связь' }).disabled).toBe(true);
    await user.clear(input);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('requires explicit identity check, retries the same draft after unknown, then locks successful form', async () => {
    const user = userEvent.setup();
    const actions = {
      previewManualCrmBinding: vi.fn().mockResolvedValue(draft),
      confirmManualCrmBinding: vi
        .fn()
        .mockResolvedValueOnce({ outcome: 'unknown' })
        .mockResolvedValueOnce({ outcome: 'linked' }),
    };
    render(<AdminCrmBinding player={player} actions={actions} />);
    await user.type(
      screen.getByLabelText('Email или ID клиента YCLIENTS'),
      '5',
    );
    await user.click(
      screen.getByRole('button', { name: 'Проверить карточку' }),
    );
    const confirm = await screen.findByRole('button', {
      name: 'Подтвердить связь',
    });
    expect(confirm.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox'));
    await user.click(confirm);
    await screen.findByText(/Результат пока неизвестен/);
    await user.click(confirm);
    await screen.findByText('Аккаунт игрока связан с карточкой YCLIENTS.');
    expect(actions.confirmManualCrmBinding.mock.calls).toEqual([
      [player.id, draft.draftId],
      [player.id, draft.draftId],
    ]);
    expect(
      screen.queryByLabelText('Email или ID клиента YCLIENTS'),
    ).toBeNull();
  });
  it('changing the chosen CRM ID discards preview and attestation', async () => {
    const user = userEvent.setup();
    const actions = {
      previewManualCrmBinding: vi.fn().mockResolvedValue(draft),
    };
    render(<AdminCrmBinding player={player} actions={actions} />);
    const input = screen.getByLabelText('Email или ID клиента YCLIENTS');
    await user.type(input, '5');
    await user.click(
      screen.getByRole('button', { name: 'Проверить карточку' }),
    );
    await screen.findByRole('checkbox');
    await user.type(input, '6');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Тест Игрок')).toBeNull();
  });
  it('shows the honest disabled state', async () => {
    const user = userEvent.setup();
    render(
      <AdminCrmBinding
        player={player}
        actions={{
          previewManualCrmBinding: async () => ({ outcome: 'not_configured' }),
        }}
      />,
    );
    await user.type(
      screen.getByLabelText('Email или ID клиента YCLIENTS'),
      '5',
    );
    await user.click(
      screen.getByRole('button', { name: 'Проверить карточку' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'пока не включена',
      ),
    );
  });
});

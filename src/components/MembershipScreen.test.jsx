// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MembershipScreen from './MembershipScreen';

vi.mock('../hooks/useTelegram', () => ({ useTelegram: () => ({ tg: null }) }));
afterEach(cleanup);

describe('MembershipScreen safe states', () => {
  it('opens own memberships first and renders only canonical fields', async () => {
    const readMemberships = vi.fn().mockResolvedValue({ outcome: 'loaded', memberships: [{
      id: '11111111-1111-4111-8111-111111111111', title: 'Клубный', status: 'active', remainingVisits: 4, expiresOn: '2035-10-05',
    }] });
    const readCatalog = vi.fn().mockResolvedValue({ outcome: 'not_configured', products: [] });
    render(<MembershipScreen readMemberships={readMemberships} readCatalog={readCatalog} onBack={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Мои абонементы' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('Клубный')).toBeTruthy();
    expect(screen.getByText('Активен')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('2035-10-05')).toBeTruthy();
    expect(readMemberships).toHaveBeenCalledTimes(1);
    expect(readCatalog).not.toHaveBeenCalled();
  });

  it('distinguishes unavailable, retry, empty and catalog not-configured states', async () => {
    const readMemberships = vi.fn()
      .mockResolvedValueOnce({ outcome: 'rejected', reason: 'unavailable' })
      .mockResolvedValueOnce({ outcome: 'loaded', memberships: [] });
    const readCatalog = vi.fn().mockResolvedValue({ outcome: 'not_configured', products: [] });
    render(<MembershipScreen readMemberships={readMemberships} readCatalog={readCatalog} onBack={() => {}} />);
    expect(await screen.findByText('Сервис временно недоступен')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('У вас пока нет абонементов')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Купить абонемент' }));
    expect(await screen.findByText('Каталог пока недоступен')).toBeTruthy();
    await waitFor(() => expect(readCatalog).toHaveBeenCalledTimes(1));
  });
});

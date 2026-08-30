// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMoscowDateRange } from '../lib/moscowDateTime';

vi.mock('../lib/paidCourtCheckout', async (importOriginal) => ({
  ...(await importOriginal()),
  YOOKASSA_COURT_CHECKOUT_ENABLED: true,
}));

import BookingScreen from './BookingScreen';

const RESERVATION_ID = '55555555-5555-4555-8555-555555555555';

describe('BookingScreen match finalization', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', {
      getRandomValues: vi.fn((bytes) => {
        bytes.fill(1);
        return bytes;
      }),
    });
    vi.stubGlobal('scrollTo', vi.fn());
    window.scrollTo = vi.fn();
  });

  it('creates one reservation and retries only match finalization with the same reservation', async () => {
    const dateISO = getMoscowDateRange(2)[1];
    const reservation = Object.freeze({
      reservationId: RESERVATION_ID,
      status: 'confirmed',
      serviceId: 30_539_679,
      courtId: 5_730_531,
      startsAt: `${dateISO}T10:00:00+03:00`,
      endsAt: `${dateISO}T11:00:00+03:00`,
      stale: false,
    });
    const createBooking = vi.fn(async () => ({
      outcome: 'booking_created',
      reservation,
    }));
    const onConfirmedReservation = vi.fn()
      .mockResolvedValueOnce({
        outcome: 'rejected',
        reason: 'temporary_unavailable',
      })
      .mockResolvedValueOnce({
        outcome: 'match_created',
        match: {
          courtBookingStatus: 'confirmed',
          courtReservationId: RESERVATION_ID,
        },
      });
    const availabilityActions = {
      listServices: vi.fn(async () => ({
        outcome: 'services_loaded',
        services: [{
          id: 30_539_679,
          title: 'Аренда корта 1ч.',
          categoryId: 27_980_310,
        }],
      })),
      listCourts: vi.fn(async () => ({
        outcome: 'courts_loaded',
        courts: [{ id: 5_730_531, name: 'Корт №1' }],
      })),
      listDates: vi.fn(async () => ({
        outcome: 'dates_loaded',
        dates: [dateISO],
      })),
      listTimes: vi.fn(async ({ date }) => ({
        outcome: 'times_loaded',
        times: [{
          time: '10:00',
          durationSeconds: 3_600,
          datetime: `${date}T10:00:00+03:00`,
        }],
      })),
      createBooking,
    };

    render(
      <BookingScreen
        availabilityActions={availabilityActions}
        bookingClient={{
          fullName: 'Тестовый Игрок',
          phone: '+7 900 000-00-00',
        }}
        reservationPurpose="match"
        onConfirmedReservation={onConfirmedReservation}
        showToast={vi.fn()}
      />,
    );

    const firstSlot = await screen.findByRole('button', {
      name: '10:00–10:30 Свободно',
    });
    fireEvent.click(firstSlot);
    fireEvent.click(await screen.findByRole('button', {
      name: '10:30–11:00 Свободно',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
    const confirmButton = await screen.findByRole('button', {
      name: /Оплатить и создать матч/u,
    });
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(createBooking).toHaveBeenCalledTimes(1);
      expect(onConfirmedReservation).toHaveBeenCalledTimes(1);
    });

    const retry = await screen.findByTestId('match-finalize-retry');
    expect(onConfirmedReservation).toHaveBeenLastCalledWith(reservation);

    fireEvent.click(retry);
    await waitFor(() => {
      expect(onConfirmedReservation).toHaveBeenCalledTimes(2);
    });
    expect(onConfirmedReservation).toHaveBeenLastCalledWith(reservation);
    expect(createBooking).toHaveBeenCalledTimes(1);
    expect(
      (await screen.findByTestId('booking-success-message')).textContent,
    ).toContain('Корт подтверждён, матч создан и связан с бронью.');
  });
});

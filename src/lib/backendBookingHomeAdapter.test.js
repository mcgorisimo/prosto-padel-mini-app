import { describe, expect, it } from 'vitest';
import {
  getBackendBookingStatusPresentation,
  mapBackendReservationToHomeEvent,
  selectBackendReservationsForHome,
  selectMissingBookingCourtServiceIds,
} from './backendBookingHomeAdapter.js';

const reservation = Object.freeze({
  reservationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  status: 'pending_confirmation',
  serviceId: 30539748,
  courtId: 5730531,
  startsAt: '2035-08-12T20:30:00+03:00',
  endsAt: '2035-08-12T22:00:00+03:00',
  stale: true,
});

describe('backend booking Home adapter', () => {
  it('maps a strict reservation to the existing Home event shape', () => {
    expect(mapBackendReservationToHomeEvent(reservation, {
      5730531: ' Корт №1 ',
    })).toEqual({
      id: 'reservation:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      reservationId: reservation.reservationId,
      type: 'private',
      isPrivate: true,
      isTraining: false,
      isBackendReservation: true,
      reservationStatus: 'pending_confirmation',
      stale: true,
      startsAt: reservation.startsAt,
      endsAt: reservation.endsAt,
      dateISO: '2035-08-12',
      time: '20:30',
      duration: 1.5,
      courtId: 5730531,
      courtName: 'Корт №1',
    });
    expect(mapBackendReservationToHomeEvent({
      ...reservation,
      endsAt: reservation.startsAt,
    })).toBeNull();
  });

  it('shows only active future reservations and removes admin-deleted ones', () => {
    const now = Date.parse('2035-08-12T19:00:00+03:00');
    expect(selectBackendReservationsForHome([
      reservation,
      { ...reservation, reservationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'cancelled' },
      { ...reservation, reservationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', status: 'rejected' },
      { ...reservation, reservationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', endsAt: '2035-08-12T18:00:00+03:00' },
    ], now)).toHaveLength(1);
  });

  it('bounds and de-duplicates missing court-catalog service requests', () => {
    expect(selectMissingBookingCourtServiceIds(
      Array.from({ length: 10 }, (_, index) => ({
        serviceId: 100 + index,
        courtId: 200 + index,
      })),
      { 202: 'Корт №3' },
      new Set([100]),
    )).toEqual([101, 103, 104, 105, 106, 107, 108]);
    expect(selectMissingBookingCourtServiceIds([], {}, new Set(
      Array.from({ length: 8 }, (_, index) => index + 1),
    ))).toEqual([]);
  });

  it('preserves truthful status presentation with a safe unknown fallback', () => {
    expect(getBackendBookingStatusPresentation('confirmed'))
      .toEqual({ label: 'Подтверждено', tone: 'confirmed' });
    expect(getBackendBookingStatusPresentation('unexpected'))
      .toEqual({ label: 'Уточняется', tone: 'pending' });
  });
});

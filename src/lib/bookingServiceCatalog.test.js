import { describe, expect, it } from 'vitest';
import {
  BOOKING_AVAILABILITY_DURATIONS,
  groupRentalServices,
  mergeBookingCourts,
  readRentalServiceDuration,
} from './bookingServiceCatalog';

describe('shared D2.1 booking service catalog', () => {
  it('keeps only confirmed one-to-two-hour rental services', () => {
    expect(BOOKING_AVAILABILITY_DURATIONS).toEqual([1, 1.5, 2]);
    expect(readRentalServiceDuration('Аренда корта 1ч.')).toBe(1);
    expect(readRentalServiceDuration('Аренда корта 1,5ч.')).toBe(1.5);
    expect(readRentalServiceDuration('Аренда корта 2ч.')).toBe(2);
    expect(readRentalServiceDuration('Аренда корта 2.5ч.')).toBeNull();
  });

  it('preserves every service variant and de-duplicates provider courts', () => {
    const groups = groupRentalServices([
      { id: 10, title: 'Аренда корта 1ч.' },
      { id: 11, title: 'Аренда корта 1ч.' },
      { id: 20, title: 'Аренда корта 2ч.' },
      { id: 25, title: 'Аренда корта 2.5ч.' },
    ]);
    expect(groups).toEqual([
      {
        duration: 1,
        services: [
          { id: 10, title: 'Аренда корта 1ч.' },
          { id: 11, title: 'Аренда корта 1ч.' },
        ],
      },
      {
        duration: 2,
        services: [{ id: 20, title: 'Аренда корта 2ч.' }],
      },
    ]);
    expect(mergeBookingCourts([
      { courts: [{ id: 2, name: 'Корт №2' }, { id: 1, name: 'Корт №1' }] },
      { courts: [{ id: 1, name: 'Корт №1' }] },
    ])).toEqual([
      { id: 1, name: 'Корт №1', type: 'panoramic' },
      { id: 2, name: 'Корт №2', type: 'panoramic' },
    ]);
  });
});

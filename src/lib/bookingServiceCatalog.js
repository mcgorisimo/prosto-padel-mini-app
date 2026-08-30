import { BOOKING_DURATIONS } from './booking';
import {
  MAX_PRIVATE_BOOKING_SLOTS,
  PRIVATE_BOOKING_SLOT_MINUTES,
} from './privateBookingSlotSelection';

export const BOOKING_AVAILABILITY_DURATIONS = Object.freeze(
  BOOKING_DURATIONS.filter(
    (duration) =>
      duration * 60 <=
      MAX_PRIVATE_BOOKING_SLOTS * PRIVATE_BOOKING_SLOT_MINUTES,
  ),
);

export function readRentalServiceDuration(title) {
  if (typeof title !== 'string') return null;
  const match = /^Аренда корта\s+(\d+(?:[.,]\d+)?)\s*ч\./iu.exec(title);
  if (!match) return null;
  const duration = Number(match[1].replace(',', '.'));
  return BOOKING_AVAILABILITY_DURATIONS.includes(duration)
    ? duration
    : null;
}

export function groupRentalServices(services) {
  const groups = new Map();
  for (const service of Array.isArray(services) ? services : []) {
    const duration = readRentalServiceDuration(service?.title);
    if (duration === null) continue;
    const current = groups.get(duration) ?? [];
    current.push(service);
    groups.set(duration, current);
  }
  return BOOKING_AVAILABILITY_DURATIONS.flatMap((duration) => {
    const matchingServices = groups.get(duration);
    return matchingServices
      ? [{ duration, services: matchingServices }]
      : [];
  });
}

export function mergeBookingCourts(results) {
  const courtsById = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    for (const court of Array.isArray(result?.courts) ? result.courts : []) {
      if (!courtsById.has(court.id)) {
        courtsById.set(court.id, {
          ...court,
          type: 'panoramic',
        });
      }
    }
  }
  return [...courtsById.values()].sort((left, right) => left.id - right.id);
}
